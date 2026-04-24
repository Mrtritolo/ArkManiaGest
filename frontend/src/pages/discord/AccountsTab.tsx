/**
 * AccountsTab.tsx — Settings -> Discord -> Accounts.
 *
 * One row per known Discord identity (anyone who has signed in via Discord
 * at least once).  Per row:
 *
 *   - Discord identity (avatar + global_name + @username + snowflake)
 *   - AppUser link  (badge + username + role; or "— Link AppUser —" button)
 *   - ARK player link (EOS_Id + ARK character name; or "— Link player —" button)
 *   - Linked at / last sync timestamps
 *   - Inline unlink buttons for the two link kinds
 *
 * Two modal flows:
 *
 *   Link AppUser  — searchable dropdown over /users (panel AppUsers).
 *   Link EOS      — debounced autocomplete via /discord/players/search.
 *
 * All write paths refresh the table in-place via `loadAccounts()` so the
 * UI stays consistent with the database after every action.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Loader2, AlertCircle, CheckCircle, Link2, Link2Off,
  UserCog, Search, Database, X, Save,
} from "lucide-react";
import {
  discordApi, usersApi,
  type DiscordAccount, type DiscordPlayerSearchHit,
} from "../../services/api";
import type { AuthUser } from "../../types";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build the CDN URL for a Discord user avatar (or null when unset). */
function avatarUrl(userId: string, hash: string | null): string | null {
  if (!hash) return null;
  // Animated avatars start with "a_"; use .gif for those, .png otherwise.
  const ext = hash.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${userId}/${hash}.${ext}?size=64`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

const ROLE_COLORS: Record<string, string> = {
  admin:    "#dc2626",
  operator: "#2563eb",
  viewer:   "#6b7280",
};

// ── Component ────────────────────────────────────────────────────────────────

export default function AccountsTab() {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<DiscordAccount[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [success, setSuccess]   = useState("");

  const [linkAppUserFor, setLinkAppUserFor] = useState<DiscordAccount | null>(null);
  const [linkEosFor,    setLinkEosFor]    = useState<DiscordAccount | null>(null);

  // Auto-clear success toast after 3 s.
  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(""), 3000);
    return () => clearTimeout(t);
  }, [success]);

  useEffect(() => { loadAccounts(); }, []);

  async function loadAccounts(): Promise<void> {
    setLoading(true);
    setError("");
    try {
      const res = await discordApi.accounts();
      setAccounts(res.data);
    } catch (err: unknown) {
      setError(extractError(err, t("discord.accounts.errors.load", "Failed to load Discord accounts.")));
    } finally {
      setLoading(false);
    }
  }

  async function handleUnlinkAppUser(acc: DiscordAccount): Promise<void> {
    if (!confirm(
      t("discord.accounts.confirmUnlinkAppUser",
        "Unlink AppUser '{{u}}' from Discord '{{d}}'?",
        { u: acc.app_user_username ?? "?", d: acc.discord_username ?? acc.discord_user_id }),
    )) return;
    try {
      await discordApi.unlinkAppUser(acc.discord_user_id);
      setSuccess(t("discord.accounts.toast.appUserUnlinked", "AppUser link removed."));
      loadAccounts();
    } catch (err: unknown) {
      setError(extractError(err, t("discord.accounts.errors.unlinkAppUser", "Failed to unlink AppUser.")));
    }
  }

  async function handleUnlinkEos(acc: DiscordAccount): Promise<void> {
    if (!confirm(
      t("discord.accounts.confirmUnlinkEos",
        "Unlink EOS player '{{e}}' from Discord '{{d}}'?",
        { e: acc.eos_id ?? "?", d: acc.discord_username ?? acc.discord_user_id }),
    )) return;
    try {
      await discordApi.unlinkEos(acc.discord_user_id);
      setSuccess(t("discord.accounts.toast.eosUnlinked", "Player link removed."));
      loadAccounts();
    } catch (err: unknown) {
      setError(extractError(err, t("discord.accounts.errors.unlinkEos", "Failed to unlink player.")));
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      {error && (
        <div className="alert alert-error" style={{ marginBottom: "0.5rem" }}>
          <AlertCircle size={14} /> {error}
        </div>
      )}
      {success && (
        <div className="alert alert-success" style={{ marginBottom: "0.5rem" }}>
          <CheckCircle size={14} /> {success}
        </div>
      )}

      {loading ? (
        <div className="pl-loading">
          <Loader2 size={20} className="pl-spin" />{" "}
          {t("discord.accounts.loading", "Loading Discord accounts…")}
        </div>
      ) : accounts.length === 0 ? (
        <div className="pl-loading" style={{ textAlign: "left" }}>
          {t(
            "discord.accounts.empty",
            "No Discord accounts yet — ask an operator to Sign in with Discord at least once.",
          )}
        </div>
      ) : (
        <table className="pl-table">
          <thead>
            <tr>
              <th>{t("discord.accounts.col.discord", "Discord")}</th>
              <th>{t("discord.accounts.col.appUser", "Panel AppUser")}</th>
              <th>{t("discord.accounts.col.player", "ARK player")}</th>
              <th>{t("discord.accounts.col.linkedAt", "Linked at")}</th>
              <th style={{ width: 60 }}></th>
            </tr>
          </thead>
          <tbody>
            {accounts.map(acc => {
              const av = avatarUrl(acc.discord_user_id, acc.discord_avatar);
              const display = acc.discord_global_name || acc.discord_username || acc.discord_user_id;
              const roleColor = acc.app_user_role
                ? ROLE_COLORS[acc.app_user_role] ?? ROLE_COLORS.viewer
                : "#6b7280";
              return (
                <tr key={acc.discord_user_id}>
                  {/* Discord identity */}
                  <td>
                    <div className="pl-cell-player">
                      {av ? (
                        <img
                          src={av}
                          alt=""
                          className="pl-avatar"
                          style={{ objectFit: "cover" }}
                        />
                      ) : (
                        <div className="pl-avatar" style={{ background: "#5865F2" }}>
                          {display[0]?.toUpperCase() ?? "?"}
                        </div>
                      )}
                      <div>
                        <span className="pl-cell-name">{display}</span>
                        <span className="pl-cell-tribe" style={{ fontSize: "0.7rem" }}>
                          {acc.discord_username
                            ? `@${acc.discord_username}  ·  ${acc.discord_user_id}`
                            : acc.discord_user_id}
                        </span>
                      </div>
                    </div>
                  </td>

                  {/* AppUser link */}
                  <td>
                    {acc.app_user_username ? (
                      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                        <span
                          className="pl-chip"
                          style={{
                            background: `${roleColor}15`,
                            color: roleColor,
                            borderColor: `${roleColor}30`,
                          }}
                        >
                          <UserCog size={9} /> {acc.app_user_username}
                          {acc.app_user_role ? ` · ${acc.app_user_role}` : ""}
                        </span>
                        <button
                          className="btn btn-secondary btn-sm"
                          style={{ padding: "0.15rem 0.35rem" }}
                          title={t("discord.accounts.action.unlinkAppUser", "Unlink AppUser")}
                          onClick={() => handleUnlinkAppUser(acc)}
                        >
                          <Link2Off size={12} />
                        </button>
                      </div>
                    ) : (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => setLinkAppUserFor(acc)}
                      >
                        <Link2 size={12} /> {t("discord.accounts.action.linkAppUser", "Link AppUser")}
                      </button>
                    )}
                  </td>

                  {/* ARK player link */}
                  <td>
                    {acc.eos_id ? (
                      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                        <span
                          className="pl-chip"
                          title={acc.eos_id}
                          style={{ background: "#16a34a15", color: "#16a34a", borderColor: "#16a34a30" }}
                        >
                          <Database size={9} /> {acc.eos_id.slice(0, 8)}…
                        </span>
                        <button
                          className="btn btn-secondary btn-sm"
                          style={{ padding: "0.15rem 0.35rem" }}
                          title={t("discord.accounts.action.unlinkEos", "Unlink player")}
                          onClick={() => handleUnlinkEos(acc)}
                        >
                          <Link2Off size={12} />
                        </button>
                      </div>
                    ) : (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => setLinkEosFor(acc)}
                      >
                        <Link2 size={12} /> {t("discord.accounts.action.linkEos", "Link player")}
                      </button>
                    )}
                  </td>

                  <td style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>
                    {fmtDate(acc.linked_at)}
                  </td>

                  <td></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* Modal: link AppUser */}
      {linkAppUserFor && (
        <LinkAppUserModal
          account={linkAppUserFor}
          onClose={() => setLinkAppUserFor(null)}
          onLinked={() => {
            setLinkAppUserFor(null);
            setSuccess(t("discord.accounts.toast.appUserLinked", "AppUser linked."));
            loadAccounts();
          }}
          onError={msg => setError(msg)}
        />
      )}

      {/* Modal: link EOS player */}
      {linkEosFor && (
        <LinkEosModal
          account={linkEosFor}
          onClose={() => setLinkEosFor(null)}
          onLinked={() => {
            setLinkEosFor(null);
            setSuccess(t("discord.accounts.toast.eosLinked", "Player linked."));
            loadAccounts();
          }}
          onError={msg => setError(msg)}
        />
      )}
    </div>
  );
}

// ── Link AppUser modal ───────────────────────────────────────────────────────

function LinkAppUserModal({
  account, onClose, onLinked, onError,
}: {
  account: DiscordAccount;
  onClose: () => void;
  onLinked: () => void;
  onError: (msg: string) => void;
}) {
  const { t } = useTranslation();
  const [users, setUsers]       = useState<AuthUser[]>([]);
  const [filter, setFilter]     = useState("");
  const [chosenId, setChosenId] = useState<number | null>(null);
  const [saving, setSaving]     = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await usersApi.list();
        setUsers(res.data);
      } catch (err: unknown) {
        onError(extractError(err, t("discord.accounts.errors.loadUsers", "Failed to load users.")));
      }
    })();
    // We intentionally re-run only on mount; onError is captured by closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return users;
    return users.filter(u =>
      u.username.toLowerCase().includes(q)
      || u.display_name.toLowerCase().includes(q)
      || u.role.toLowerCase().includes(q),
    );
  }, [users, filter]);

  async function save(): Promise<void> {
    if (chosenId == null) return;
    setSaving(true);
    try {
      await discordApi.linkAppUser(account.discord_user_id, { app_user_id: chosenId });
      onLinked();
    } catch (err: unknown) {
      onError(extractError(err, t("discord.accounts.errors.linkAppUser", "Failed to link AppUser.")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell onClose={onClose} title={
      t("discord.accounts.modal.linkAppUserTitle",
        "Link AppUser to {{d}}",
        { d: account.discord_global_name || account.discord_username || account.discord_user_id })
    }>
      <div className="form-group">
        <label className="form-label">
          <Search size={11} /> {t("discord.accounts.modal.filter", "Filter users")}
        </label>
        <input
          autoFocus
          className="form-input"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder={t("discord.accounts.modal.filterPh", "name, username or role…")}
        />
      </div>
      <div
        style={{
          maxHeight: 280, overflowY: "auto",
          border: "1px solid var(--border)", borderRadius: 6, padding: "0.25rem 0",
        }}
      >
        {visible.length === 0 && (
          <div style={{ padding: "0.5rem", fontSize: "0.78rem", color: "var(--text-secondary)" }}>
            {t("discord.accounts.modal.noUsers", "No users match the filter.")}
          </div>
        )}
        {visible.map(u => {
          const color = ROLE_COLORS[u.role] ?? ROLE_COLORS.viewer;
          const active = chosenId === u.id;
          return (
            <div
              key={u.id}
              onClick={() => setChosenId(u.id)}
              style={{
                display: "flex", alignItems: "center", gap: "0.5rem",
                padding: "0.4rem 0.55rem", cursor: "pointer",
                background: active ? "var(--accent-50, #2563eb22)" : "transparent",
                borderLeft: active ? "3px solid var(--accent, #2563eb)" : "3px solid transparent",
              }}
            >
              <div className="pl-avatar" style={{ width: 26, height: 26, fontSize: 11 }}>
                {u.display_name[0]?.toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "0.85rem", fontWeight: 500 }}>{u.display_name}</div>
                <div style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>@{u.username}</div>
              </div>
              <span
                className="pl-chip"
                style={{ background: `${color}15`, color, borderColor: `${color}30` }}
              >
                {u.role}
              </span>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "0.75rem" }}>
        <button onClick={onClose} className="btn btn-secondary btn-sm">{t("common.cancel", "Cancel")}</button>
        <button
          onClick={save}
          disabled={saving || chosenId == null}
          className="btn btn-primary btn-sm"
        >
          {saving ? <Loader2 size={14} className="pl-spin" /> : <Save size={14} />}
          {" "}{t("discord.accounts.modal.linkBtn", "Link")}
        </button>
      </div>
    </ModalShell>
  );
}

// ── Link EOS modal ───────────────────────────────────────────────────────────

function LinkEosModal({
  account, onClose, onLinked, onError,
}: {
  account: DiscordAccount;
  onClose: () => void;
  onLinked: () => void;
  onError: (msg: string) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery]     = useState("");
  const [hits, setHits]       = useState<DiscordPlayerSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [chosen, setChosen]   = useState<DiscordPlayerSearchHit | null>(null);
  const [saving, setSaving]   = useState(false);
  const lastQueryRef = useRef("");

  // Debounced search.
  useEffect(() => {
    const q = query.trim();
    lastQueryRef.current = q;
    if (q.length < 2) {
      setHits([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await discordApi.searchPlayers(q);
        // Drop late responses if the operator typed something else meanwhile.
        if (lastQueryRef.current === q) setHits(res.data);
      } catch (err: unknown) {
        if (lastQueryRef.current === q) {
          onError(extractError(err, t("discord.accounts.errors.search", "Player search failed.")));
        }
      } finally {
        if (lastQueryRef.current === q) setSearching(false);
      }
    }, 220);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  async function save(): Promise<void> {
    if (!chosen) return;
    setSaving(true);
    try {
      await discordApi.linkEos(account.discord_user_id, chosen.eos_id);
      onLinked();
    } catch (err: unknown) {
      onError(extractError(err, t("discord.accounts.errors.linkEos", "Failed to link player.")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell onClose={onClose} title={
      t("discord.accounts.modal.linkEosTitle",
        "Link ARK player to {{d}}",
        { d: account.discord_global_name || account.discord_username || account.discord_user_id })
    }>
      <div className="form-group">
        <label className="form-label">
          <Search size={11} /> {t("discord.accounts.modal.search", "Search by name, EOS or tribe")}
        </label>
        <input
          autoFocus
          className="form-input"
          value={query}
          onChange={e => { setChosen(null); setQuery(e.target.value); }}
          placeholder={t("discord.accounts.modal.searchPh", "min. 2 chars…")}
        />
      </div>
      <div
        style={{
          maxHeight: 280, overflowY: "auto",
          border: "1px solid var(--border)", borderRadius: 6, padding: "0.25rem 0",
          minHeight: 80,
        }}
      >
        {searching && (
          <div style={{ padding: "0.5rem", fontSize: "0.78rem", color: "var(--text-secondary)" }}>
            <Loader2 size={11} className="pl-spin" />{" "}
            {t("discord.accounts.modal.searching", "Searching…")}
          </div>
        )}
        {!searching && query.trim().length >= 2 && hits.length === 0 && (
          <div style={{ padding: "0.5rem", fontSize: "0.78rem", color: "var(--text-secondary)" }}>
            {t("discord.accounts.modal.noHits", "No players match.")}
          </div>
        )}
        {hits.map(h => {
          const active = chosen?.eos_id === h.eos_id;
          return (
            <div
              key={h.eos_id}
              onClick={() => setChosen(h)}
              style={{
                display: "flex", alignItems: "center", gap: "0.5rem",
                padding: "0.4rem 0.55rem", cursor: "pointer",
                background: active ? "var(--accent-50, #2563eb22)" : "transparent",
                borderLeft: active ? "3px solid var(--accent, #2563eb)" : "3px solid transparent",
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "0.85rem", fontWeight: 500 }}>
                  {h.name || <span style={{ color: "var(--text-secondary)" }}>(no name)</span>}
                </div>
                <div style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>
                  EOS: {h.eos_id}{h.tribe_name ? ` · ${h.tribe_name}` : ""}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "0.75rem" }}>
        <button onClick={onClose} className="btn btn-secondary btn-sm">{t("common.cancel", "Cancel")}</button>
        <button
          onClick={save}
          disabled={saving || !chosen}
          className="btn btn-primary btn-sm"
        >
          {saving ? <Loader2 size={14} className="pl-spin" /> : <Save size={14} />}
          {" "}{t("discord.accounts.modal.linkBtn", "Link")}
        </button>
      </div>
    </ModalShell>
  );
}

// ── Tiny modal shell + error helper ──────────────────────────────────────────

function ModalShell({
  title, onClose, children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "var(--surface, #fff)", color: "var(--text)",
          padding: "1rem 1.1rem", borderRadius: 8, minWidth: 420,
          maxWidth: 560, boxShadow: "0 10px 40px rgba(0,0,0,0.35)",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: "0.6rem", borderBottom: "1px solid var(--border)",
          paddingBottom: "0.4rem",
        }}>
          <span style={{ fontWeight: 600 }}>{title}</span>
          <button onClick={onClose} className="pl-btn-icon" style={{ width: 24, height: 24 }}>
            <X size={12} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function extractError(err: unknown, fallback: string): string {
  const msg =
    (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
    ?? (err as { message?: string })?.message
    ?? fallback;
  return typeof msg === "string" ? msg : fallback;
}
