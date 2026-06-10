# GDPR & NIS2 Compliance Notes

How ArkManiaGest maps onto Regulation (EU) 2016/679 (GDPR) and Directive
(EU) 2022/2555 (NIS2).  Audience: the operator deploying the panel, who
acts as **data controller** for their cluster.  This document describes
what the software provides; organisational measures (naming a contact
point, registering with authorities where applicable) remain the
operator's responsibility.

> The user-facing privacy notice lives in the SPA at `/privacy`
> (IT + EN, reachable before login).  Keep it in sync with this file
> when data flows change.

---

## 1. Personal-data inventory

| Data | Where | Encryption | Why |
|---|---|---|---|
| Panel account (username, display name, bcrypt password hash, role, last login) | `arkmaniagest_users` (panel DB) | hash only | panel access |
| Discord identity (snowflake ID, username, global name, avatar hash) | `arkmaniagest_discord_accounts` | — | Discord sign-in |
| Discord OAuth access/refresh tokens | `arkmaniagest_discord_accounts.*_enc` | AES-256-GCM | profile reads (`identify` scope only; e-mail is never requested) |
| EOS player ID link | `arkmaniagest_discord_accounts.eos_id` | — | player dashboard |
| Game data (character name, tribe, permissions, shop, leaderboard, session login times + IPs) | plugin DB (`Players`, `ARKM_*`) | — | owned by the game plugins; the panel reads it |
| Source IP of requests | in-memory rate limiter; `arkmaniagest_audit_log` | — | brute-force protection, audit trail |
| Admin action history (username, action, stdout/stderr) | `ARKM_instance_actions` | — | operations audit |
| Security events (login success/failure, user mgmt, SQL console, GDPR requests) | `arkmaniagest_audit_log` | — | NIS2 audit trail |

Third-party flows: **Discord** only (OAuth sign-in + optional bot/role
sync).  No analytics, no advertising, no CDN-hosted assets.

## 2. Data-subject rights (GDPR Arts. 13–20)

| Right | Implementation |
|---|---|
| Information (Art. 13) | `/privacy` page, linked from the login screen and the player dashboard |
| Access / portability (Arts. 15, 20) | `GET /api/v1/me/privacy/export` — self-service JSON export from the player dashboard ("Export my data"); works for unlinked Discord identities too |
| Erasure (Art. 17) | `DELETE /api/v1/me/privacy/account` — deletes the Discord account row (profile + encrypted tokens + player link) and the auto-provisioned `discord:<id>` stub user, then clears the session cookie ("Delete my account") |
| Rectification / restriction / objection | manual, via the operator (admin UI: Settings → Discord → Accounts; Users page) |

Every export/erasure request is recorded in the audit log
(`gdpr.export`, `gdpr.account_delete`) with the Discord numeric ID only.

## 3. Retention

Controlled by `DATA_RETENTION_DAYS` in `.env` (default **365**, `0`
disables).  A daily background job (`app/services/retention.py`, started
from the FastAPI lifespan) purges rows older than the horizon from the
panel-owned history tables:

- `arkmaniagest_audit_log`
- `ARKM_instance_actions`

Other horizons:

- Discord session cookie: 24 h; OAuth state cookie: 10 min.
- Rate-limiter IP tracking: in-memory only, minutes.
- OAuth tokens + Discord profile: until erasure (self-service or admin).
- Plugin-DB tables (`ARKM_sessions`, `ARKM_event_log`, …) are owned by
  the game plugins; the panel never auto-purges them (two-databases
  rule).  Operators can prune the event log manually via the existing
  purge endpoint (`keep_days` parameter) and should document their
  game-side retention.

## 4. Cookie / ePrivacy position

Only strictly necessary cookies are set (`disc_oauth_state`,
`disc_session`; HttpOnly + Secure + SameSite=Lax).  `localStorage`
holds UI preferences (theme, language); `sessionStorage` holds the
panel JWT for the tab lifetime.  No tracking or analytics → no consent
banner required; the `/privacy` page documents this.

## 5. NIS2 risk-management measures (Art. 21) mapping

| Measure | Implementation |
|---|---|
| Access control | JWT (HS256, 24 h expiry, audience claim, JTI), bcrypt hashing, three roles (admin/operator/viewer), router-level guards (`api/routes/__init__.py`), last-admin protection |
| Password policy | 12+ characters with letters + digits on every password-setting path (user create/update, own change, first-run setup) — `app/schemas/auth.py::validate_password_strength` |
| Cryptography | AES-256-GCM for all secrets at rest (`*_enc` columns), TLS 1.2/1.3 only with modern ciphers (deploy/nginx-production.conf), auto-generated 256-bit `JWT_SECRET` / `FIELD_ENCRYPTION_KEY` |
| Logging & detection | `arkmaniagest_audit_log` (logins incl. failures with source IP, user management, SQL console usage, GDPR requests) — readable via admin-only `GET /api/v1/audit`; instance lifecycle in `ARKM_instance_actions`; systemd journal + `/var/log/arkmaniagest/` |
| Brute-force / DoS resistance | per-IP rate limiting (120 req/min general, 10 req/min auth, 5-min block), request-size caps, optional IP allowlist, fail2ban + UFW + GeoIP filtering in deploy |
| Backup & recovery | `deploy/backup.sh` (daily cron, both DBs + `.env` + nginx, chmod 600, last 20 kept), `deploy/restore.sh` |
| Supply-chain / update integrity | self-updater verifies SHA-256 against published SHA256SUMS before install; HTTPS-only downloads |
| Incident handling | see §6 |

Known gaps (tracked, accepted for an internal admin tool — revisit if
exposure grows): no MFA (mitigate by fronting the panel with the GeoIP
+ IP-allowlist layers and using Discord OAuth, which inherits Discord's
MFA); lockout is per-IP rather than per-account; Python dependencies
are lower-bounded rather than lock-pinned.

## 6. Incident-response procedure

1. **Detect / triage** — signals: `GET /api/v1/audit` (repeated
   `auth.login_failed`, unexpected `sql.execute` / `users.*`),
   `/health` schema errors, fail2ban notifications, journal errors
   (`journalctl -u arkmaniagest-backend`).
2. **Contain** — block source IPs (UFW / `ALLOWED_IPS`), disable
   compromised accounts (Users page or SQL console), or stop the
   service: `systemctl stop arkmaniagest-backend`.
3. **Rotate** — on suspected credential exposure: rotate the affected
   user passwords; if `.env` may have leaked, regenerate `JWT_SECRET`
   (invalidates every session) and rotate `PUBLIC_API_KEY` /
   `CRON_SECRET` / Discord client secret + bot token.  Note:
   `FIELD_ENCRYPTION_KEY` cannot be swapped blindly — stored `*_enc`
   blobs must be re-encrypted (re-enter SSH/DB/Discord credentials).
4. **Recover** — restore from the latest `deploy/backup.sh` tarball via
   `deploy/restore.sh`; verify `/health` shows no `schema_init_errors`.
5. **Report** — NIS2 (where the operator falls in scope): early warning
   to the national CSIRT within **24 h** of awareness of a significant
   incident, incident notification within **72 h**, final report within
   one month.  GDPR: personal-data breaches to the supervisory
   authority within **72 h** (Art. 33) and to affected users when
   high-risk (Art. 34).  The audit log and journal provide the
   who/what/when evidence.
6. **Post-mortem** — record cause and fix; keep the relevant audit-log
   extract beyond the retention window by exporting it before purge.

## 7. Operator checklist

- [ ] Serve the panel exclusively over HTTPS (`deploy/setup-ssl.sh`).
- [ ] Set `TRUSTED_PROXY_IPS` if behind a reverse proxy (audit-log IPs
      are wrong otherwise).
- [ ] Review `DATA_RETENTION_DAYS` against your local requirements.
- [ ] Publish a contact channel for privacy requests (the `/privacy`
      page points users to your community channels).
- [ ] Enable daily backups (`deploy/setup-cron.sh`) and test
      `restore.sh` at least once.
- [ ] Keep dependencies updated (`update-panel.sh`) and watch the
      GitHub releases feed.
