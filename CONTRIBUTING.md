# Contributing to ArkManiaGest

Thank you for considering a contribution.

ArkManiaGest is **source-available, not open source** — see
[LICENSE](LICENSE).  Contributions are welcome, but the licensing model
imposes a few rules that you must understand before opening a PR.

---

## Contribution licence (read first)

By submitting a pull request you agree that:

1. **You wrote the code yourself** (or you have the right to submit it
   under the same terms — for example, your employer has authorised
   the contribution).
2. Your contribution becomes part of ArkManiaGest under the
   [ArkManiaGest Source-Available License v1.0](LICENSE).
3. **Copyright on your contribution is assigned to Lomatek / ArkMania.it**
   so that we can keep the codebase under a single, consistent licence
   and so that we retain the right to relicense, sublicense, or use
   the code commercially in the future.
4. You waive any moral right that would prevent the standard handling
   of licensed contributions (modification, integration, removal).

The PR template asks you to confirm these points explicitly.  PRs that
do not include the confirmation cannot be merged.

If you cannot accept these terms, please open an **issue** describing
the change instead — we may be able to implement it ourselves.

---

## Development setup

See the **Quick setup** section in [README.md](README.md#quick-setup-development).

---

## Coding conventions

### General

- All code, comments, docstrings, commit messages, and pull-request
  descriptions are in **English**.
- User-facing strings (UI labels, button text, form placeholders, error
  messages shown in the browser) are added to **both** locale files at
  the same time:
  - `frontend/src/i18n/locales/en.json`
  - `frontend/src/i18n/locales/it.json`
- Never commit secrets, real server IPs, real admin IPs, or production
  hostnames.  The `deploy/deploy.conf.example` template uses
  placeholders — keep it that way.

### Backend (Python / FastAPI)

- Python 3.12+, type-annotated.
- Routes live in `backend/app/api/routes/`, schemas in
  `backend/app/schemas/`, ORM models in `backend/app/db/models/`.
- The **panel** DB (`get_db` / `get_panel_db`) and the **plugin** DB
  (`get_plugin_db`) are separate; pick the right dependency per route.
- New tables in the panel DB must be added to
  `backend/app/db/models/app.py` AND a corresponding migration SQL must
  be placed in `deploy/migrations/NNN_short_description.sql` so existing
  installations can `ALTER TABLE` on upgrade.
- Sensitive fields (passwords, secrets) are stored AES-256-GCM
  encrypted via `app.core.encryption` — never write them in plaintext.

### Frontend (React + TypeScript + Vite)

- Use functional components and hooks.
- Keep styles in `index.css` (custom CSS) — we do not use Tailwind
  utility classes in components.
- All UI text comes from `useTranslation()` (react-i18next).
- API calls go through `services/api.ts`; do not call `axios` directly
  from a component.

### Deploy scripts

- Shell scripts target Bash on Ubuntu.  Always pass `bash -n script.sh`
  before committing.
- PowerShell scripts target Windows PowerShell 5.1 (the version shipped
  with Windows).
- Idempotence is mandatory — every script must be safe to re-run.

---

## Commit messages

- Imperative mood, English, ≤72 chars in the title.
- Body explains *why* the change is needed, not just *what* it does.
- One logical change per commit; avoid mixing refactors and feature
  work.

---

## Reporting bugs / requesting features

Please use the templates in `.github/ISSUE_TEMPLATE/`.

For security vulnerabilities follow [SECURITY.md](SECURITY.md) instead
of opening a public issue.
