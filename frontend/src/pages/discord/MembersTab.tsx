/**
 * MembersTab.tsx — Settings -> Discord -> Guild members.
 *
 * Loads the guild member list from /api/v1/discord/guild/members and
 * renders one row per member with inline moderation actions:
 *
 *   - Assign / remove role (popover with the full role list)
 *   - Send DM (modal with a textarea, capped to Discord's 2 000-char limit)
 *   - Kick    (confirmation prompt)
 *   - Ban     (modal with reason + delete-message-seconds picker)
 *
 * The page also surfaces a top banner with the guild snapshot (name +
 * member count) so the operator immediately sees which guild the bot
 * is wired to.
 *
 * Pagination: Discord's /guild/members caps a single call at 1000.
 * The "Load more" button walks pages by passing after=<last_user_id>;
 * the chosen page-size of 100 keeps the UI responsive on big guilds.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Loader2, AlertCircle, CheckCircle, RefreshCw, Plus, X,
  UserMinus, Ban as BanIcon, Send, MessageSquare, Shield,
} from "lucide-react";
import {
  discordApi,
  type DiscordGuildInfo, type DiscordGuildRole, type DiscordGuildMember,
} from "../../services/api";

const PAGE_SIZE = 100;

// ── Helpers ──────────────────────────────────────────────────────────────────

function avatarUrl(userId: string, hash: string | null): string | null {
  if (!hash) return null;
  const ext = hash.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${userId}/${hash}.${ext}?size=64`;
}

/**
 * Convert a Discord role color (decimal RGB int) to a CSS hex string.
 * Color 0 means "no override" -- caller should fall back to a neutral grey.
 */
function roleColorHex(c: number): string {
  if (!c) return "#6b7280";
  return "#" + c.toString(16).padStart(6, "0");
}

function fmtJoinedAt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

function extractError(err: unknown, fallback: string): string {
  const msg =
    (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
    ?? (err as { message?: string })?.message
    ?? fallback;
  return typeof msg === "string" ? msg : fallback;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function MembersTab() {
  const { t } = useTranslation();

  const [guild, setGuild]       = useState<DiscordGuildInfo | null>(null);
  const [roles, setRoles]       = useState<DiscordGuildRole[]>([]);
  const [members, setMembers]   = useState<DiscordGuildMember[]>([]);
  const [loading, setLoading]   = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore]   = useState(false);
  const [error, setError]       = useState("");
  const [success, setSuccess]   = useState("");

  // Modal state.
  const [dmFor,  setDmFor]  = useState<DiscordGuildMember | null>(null);
  const [banFor, setBanFor] = useState<DiscordGuildMember | null>(null);
  const [rolePopoverFor, setRolePopoverFor] = useState<string | null>(null);

  // Auto-clear success toast.
  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(""), 3000);
    return () => clearTimeout(t);
  }, [success]);

  useEffect(() => { loadAll(); }, []);

  async function loadAll(): Promise<void> {
    setLoading(true);
    setError("");
    try {
      // Fire guild + roles + first members page in parallel.
      const [g, r, m] = await Promise.all([
        discordApi.guildInfo(),
        discordApi.guildRoles(),
        discordApi.guildMembers({ limit: PAGE_SIZE }),
      ]);
      setGuild(g.data);
      setRoles(r.data);
      setMembers(m.data);
      setHasMore(m.data.length >= PAGE_SIZE);
    } catch (err: unknown) {
      setError(extractError(err, t("discord.members.errors.load", "Failed to load guild data.")));
    } finally {
      setLoading(false);
    }
  }

  async function loadMore(): Promise<void> {
    const last = members[members.length - 1];
    if (!last) return;
    setLoadingMore(true);
    setError("");
    try {
      const res = await discordApi.guildMembers({ limit: PAGE_SIZE, after: last.user_id });
      setMembers(prev => [...prev, ...res.data]);
      setHasMore(res.data.length >= PAGE_SIZE);
    } catch (err: unknown) {
      setError(extractError(err, t("discord.members.errors.loadMore", "Failed to load more members.")));
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleAssignRole(userId: string, roleId: string): Promise<void> {
    try {
      await discordApi.assignRole(userId, roleId);
      setSuccess(t("discord.members.toast.roleAssigned", "Role assigned."));
      // Update the local row in-place so the chip appears immediately
      // without a full reload.
      setMembers(prev => prev.map(m =>
        m.user_id === userId
          ? { ...m, roles: Array.from(new Set([...m.roles, roleId])) }
          : m,
      ));
    } catch (err: unknown) {
      setError(extractError(err, t("discord.members.errors.assignRole", "Failed to assign role.")));
    } finally {
      setRolePopoverFor(null);
    }
  }

  async function handleRemoveRole(userId: string, roleId: string): Promise<void> {
    try {
      await discordApi.removeRole(userId, roleId);
      setSuccess(t("discord.members.toast.roleRemoved", "Role removed."));
      setMembers(prev => prev.map(m =>
        m.user_id === userId
          ? { ...m, roles: m.roles.filter(r => r !== roleId) }
          : m,
      ));
    } catch (err: unknown) {
      setError(extractError(err, t("discord.members.errors.removeRole", "Failed to remove role.")));
    }
  }

  async function handleKick(m: DiscordGuildMember): Promise<void> {
    if (!confirm(
      t("discord.members.confirmKick",
        "Kick {{u}} from the guild?",
        { u: m.global_name || m.username || m.user_id }),
    )) return;
    try {
      await discordApi.kickMember(m.user_id);
      setSuccess(t("discord.members.toast.kicked", "Member kicked."));
      setMembers(prev => prev.filter(x => x.user_id !== m.user_id));
    } catch (err: unknown) {
      setError(extractError(err, t("discord.members.errors.kick", "Failed to kick member.")));
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

      {/* Guild banner */}
      <div
        className="pl-sync-panel"
        style={{
          marginBottom: "0.8rem",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0.6rem 0.8rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          {guild?.icon && (
            <img
              src={`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=64`}
              alt=""
              style={{ width: 36, height: 36, borderRadius: 6 }}
            />
          )}
          <div>
            <div style={{ fontWeight: 600 }}>
              {guild?.name ?? t("discord.members.banner.loading", "Loading guild…")}
            </div>
            <div style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>
              {guild
                ? t(
                    "discord.members.banner.counts",
                    "{{m}} members · {{p}} online",
                    {
                      m: guild.approximate_member_count ?? "?",
                      p: guild.approximate_presence_count ?? "?",
                    },
                  )
                : ""}
            </div>
          </div>
        </div>
        <button onClick={loadAll} className="btn btn-secondary btn-sm">
          <RefreshCw size={12} /> {t("common.refresh", "Refresh")}
        </button>
      </div>

      {loading ? (
        <div className="pl-loading">
          <Loader2 size={20} className="pl-spin" />{" "}
          {t("discord.members.loading", "Loading guild members…")}
        </div>
      ) : members.length === 0 ? (
        <div className="pl-loading" style={{ textAlign: "left" }}>
          {t(
            "discord.members.empty",
            "No members visible.  Make sure the bot has the GUILD_MEMBERS privileged intent enabled in the Discord Developer Portal.",
          )}
        </div>
      ) : (
        <>
          <table className="pl-table">
            <thead>
              <tr>
                <th>{t("discord.members.col.user", "User")}</th>
                <th>{t("discord.members.col.roles", "Roles")}</th>
                <th style={{ width: 110 }}>{t("discord.members.col.joined", "Joined")}</th>
                <th style={{ width: 200 }}></th>
              </tr>
            </thead>
            <tbody>
              {members.map(m => (
                <MemberRow
                  key={m.user_id}
                  member={m}
                  roles={roles}
                  popoverOpen={rolePopoverFor === m.user_id}
                  onTogglePopover={() => setRolePopoverFor(p => p === m.user_id ? null : m.user_id)}
                  onAssignRole={(roleId) => handleAssignRole(m.user_id, roleId)}
                  onRemoveRole={(roleId) => handleRemoveRole(m.user_id, roleId)}
                  onKick={() => handleKick(m)}
                  onBan={() => setBanFor(m)}
                  onDm={() => setDmFor(m)}
                />
              ))}
            </tbody>
          </table>

          {hasMore && (
            <div style={{ marginTop: "0.6rem", textAlign: "center" }}>
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="btn btn-secondary btn-sm"
              >
                {loadingMore
                  ? <Loader2 size={12} className="pl-spin" />
                  : <Plus size={12} />}
                {" "}
                {t("discord.members.loadMore", "Load more")}
              </button>
            </div>
          )}
        </>
      )}

      {dmFor && (
        <DmModal
          member={dmFor}
          onClose={() => setDmFor(null)}
          onSent={() => { setDmFor(null); setSuccess(t("discord.members.toast.dmSent", "DM sent.")); }}
          onError={msg => { setDmFor(null); setError(msg); }}
        />
      )}
      {banFor && (
        <BanModal
          member={banFor}
          onClose={() => setBanFor(null)}
          onBanned={() => {
            setBanFor(null);
            setSuccess(t("discord.members.toast.banned", "Member banned."));
            setMembers(prev => prev.filter(x => x.user_id !== banFor.user_id));
          }}
          onError={msg => { setBanFor(null); setError(msg); }}
        />
      )}
    </div>
  );
}

// ── Per-member row ───────────────────────────────────────────────────────────

function MemberRow({
  member, roles, popoverOpen, onTogglePopover,
  onAssignRole, onRemoveRole, onKick, onBan, onDm,
}: {
  member: DiscordGuildMember;
  roles: DiscordGuildRole[];
  popoverOpen: boolean;
  onTogglePopover: () => void;
  onAssignRole: (roleId: string) => void;
  onRemoveRole: (roleId: string) => void;
  onKick: () => void;
  onBan:  () => void;
  onDm:   () => void;
}) {
  const { t } = useTranslation();
  const av = avatarUrl(member.user_id, member.avatar);
  const display = member.global_name || member.nick || member.username || member.user_id;

  // Pre-index role lookup for O(1) per-tag rendering.
  const rolesById = useMemo(() => {
    const m = new Map<string, DiscordGuildRole>();
    for (const r of roles) m.set(r.id, r);
    return m;
  }, [roles]);

  // Roles already assigned to this member -- shown as removable chips.
  const assigned = member.roles
    .map(id => rolesById.get(id))
    .filter((r): r is DiscordGuildRole => Boolean(r))
    .sort((a, b) => b.position - a.position);

  // Roles NOT yet assigned -- the popover offers these.  We strip the
  // @everyone role (always present, can't be assigned) and managed roles
  // (controlled by integrations like Twitch / Patreon).
  const assignable = roles
    .filter(r => !member.roles.includes(r.id) && r.name !== "@everyone" && !r.managed);

  return (
    <tr>
      <td>
        <div className="pl-cell-player">
          {av ? (
            <img src={av} alt="" className="pl-avatar" style={{ objectFit: "cover" }} />
          ) : (
            <div className="pl-avatar" style={{ background: "#5865F2" }}>
              {display[0]?.toUpperCase() ?? "?"}
            </div>
          )}
          <div>
            <span className="pl-cell-name">{display}</span>
            <span className="pl-cell-tribe" style={{ fontSize: "0.7rem" }}>
              {member.username ? `@${member.username}` : member.user_id}
            </span>
          </div>
        </div>
      </td>

      <td>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", alignItems: "center" }}>
          {assigned.map(r => {
            const c = roleColorHex(r.color);
            return (
              <span
                key={r.id}
                className="pl-chip"
                style={{
                  background: `${c}1a`, color: c, borderColor: `${c}40`,
                  cursor: "pointer",
                }}
                onClick={() => onRemoveRole(r.id)}
                title={t("discord.members.action.removeRole", "Click to remove")}
              >
                <Shield size={9} /> {r.name}
                <X size={9} style={{ marginLeft: 3, opacity: 0.7 }} />
              </span>
            );
          })}
          <div style={{ position: "relative" }}>
            <button
              className="btn btn-secondary btn-sm"
              style={{ padding: "0.15rem 0.35rem" }}
              onClick={onTogglePopover}
              title={t("discord.members.action.assignRole", "Assign role")}
            >
              <Plus size={11} />
            </button>
            {popoverOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 4px)",
                  left: 0,
                  background: "var(--surface, #fff)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  boxShadow: "0 6px 24px rgba(0,0,0,0.25)",
                  zIndex: 10,
                  minWidth: 220,
                  maxHeight: 280,
                  overflowY: "auto",
                  padding: "0.25rem 0",
                }}
              >
                {assignable.length === 0 ? (
                  <div style={{ padding: "0.5rem", fontSize: "0.78rem", color: "var(--text-secondary)" }}>
                    {t("discord.members.popover.noRoles", "No roles available.")}
                  </div>
                ) : assignable.map(r => {
                  const c = roleColorHex(r.color);
                  return (
                    <div
                      key={r.id}
                      onClick={() => onAssignRole(r.id)}
                      style={{
                        display: "flex", alignItems: "center", gap: "0.4rem",
                        padding: "0.3rem 0.55rem", cursor: "pointer", fontSize: "0.82rem",
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = "var(--accent-50, #2563eb15)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                    >
                      <span
                        style={{
                          width: 9, height: 9, borderRadius: 99,
                          background: c, flexShrink: 0,
                        }}
                      />
                      {r.name}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </td>

      <td style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>
        {fmtJoinedAt(member.joined_at)}
      </td>

      <td>
        <div style={{ display: "flex", gap: "0.3rem", justifyContent: "flex-end" }}>
          <button
            className="btn btn-secondary btn-sm"
            style={{ padding: "0.2rem 0.4rem" }}
            title={t("discord.members.action.dm", "Send DM")}
            onClick={onDm}
          >
            <MessageSquare size={12} />
          </button>
          <button
            className="btn btn-secondary btn-sm"
            style={{ padding: "0.2rem 0.4rem", color: "#d97706" }}
            title={t("discord.members.action.kick", "Kick")}
            onClick={onKick}
          >
            <UserMinus size={12} />
          </button>
          <button
            className="btn btn-secondary btn-sm"
            style={{ padding: "0.2rem 0.4rem", color: "#dc2626" }}
            title={t("discord.members.action.ban", "Ban")}
            onClick={onBan}
          >
            <BanIcon size={12} />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ── DM modal ─────────────────────────────────────────────────────────────────

function DmModal({
  member, onClose, onSent, onError,
}: {
  member: DiscordGuildMember;
  onClose: () => void;
  onSent: () => void;
  onError: (msg: string) => void;
}) {
  const { t } = useTranslation();
  const [content, setContent] = useState("");
  const [saving, setSaving]   = useState(false);
  const remaining = 2000 - content.length;

  async function send(): Promise<void> {
    const c = content.trim();
    if (!c) return;
    setSaving(true);
    try {
      await discordApi.dmUser(member.user_id, c);
      onSent();
    } catch (err: unknown) {
      onError(extractError(err, t("discord.members.errors.dm", "Failed to send DM.")));
    } finally {
      setSaving(false);
    }
  }

  const display = member.global_name || member.username || member.user_id;
  return (
    <ModalShell onClose={onClose} title={
      t("discord.members.modal.dmTitle", "Send DM to {{u}}", { u: display })
    }>
      <div className="form-group">
        <label className="form-label">{t("discord.members.modal.message", "Message")}</label>
        <textarea
          autoFocus
          className="form-input"
          value={content}
          onChange={e => setContent(e.target.value.slice(0, 2000))}
          rows={6}
          placeholder={t("discord.members.modal.dmPh", "Plain text only.  Markdown is supported.")}
          style={{ resize: "vertical", minHeight: 120 }}
        />
        <div style={{
          fontSize: "0.7rem", color: remaining < 100 ? "#dc2626" : "var(--text-secondary)",
          marginTop: 4, textAlign: "right",
        }}>
          {remaining} / 2000
        </div>
      </div>
      <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "0.75rem" }}>
        <button onClick={onClose} className="btn btn-secondary btn-sm">{t("common.cancel", "Cancel")}</button>
        <button
          onClick={send}
          disabled={saving || !content.trim()}
          className="btn btn-primary btn-sm"
        >
          {saving ? <Loader2 size={14} className="pl-spin" /> : <Send size={14} />}
          {" "}{t("discord.members.modal.dmSend", "Send")}
        </button>
      </div>
    </ModalShell>
  );
}

// ── Ban modal ────────────────────────────────────────────────────────────────

function BanModal({
  member, onClose, onBanned, onError,
}: {
  member: DiscordGuildMember;
  onClose: () => void;
  onBanned: () => void;
  onError: (msg: string) => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason]     = useState("");
  const [purgeDays, setPurgeDays] = useState(0);    // 0..7
  const [saving, setSaving]     = useState(false);

  async function ban(): Promise<void> {
    setSaving(true);
    try {
      await discordApi.banMember(member.user_id, {
        reason: reason.trim() || undefined,
        delete_message_seconds: purgeDays * 86400,
      });
      onBanned();
    } catch (err: unknown) {
      onError(extractError(err, t("discord.members.errors.ban", "Failed to ban member.")));
    } finally {
      setSaving(false);
    }
  }

  const display = member.global_name || member.username || member.user_id;
  return (
    <ModalShell onClose={onClose} title={
      t("discord.members.modal.banTitle", "Ban {{u}}", { u: display })
    }>
      <div className="form-group">
        <label className="form-label">
          {t("discord.members.modal.reason", "Audit-log reason (optional)")}
        </label>
        <input
          className="form-input"
          value={reason}
          maxLength={512}
          onChange={e => setReason(e.target.value)}
          placeholder={t("discord.members.modal.reasonPh", "e.g. spam, raid, violation of server rules")}
        />
      </div>
      <div className="form-group">
        <label className="form-label">
          {t("discord.members.modal.purge", "Delete recent messages")}
        </label>
        <select
          className="form-input"
          value={purgeDays}
          onChange={e => setPurgeDays(Number(e.target.value))}
        >
          <option value={0}>{t("discord.members.modal.purgeNone", "Don't delete")}</option>
          <option value={1}>{t("discord.members.modal.purge1d", "Last 24 hours")}</option>
          <option value={3}>{t("discord.members.modal.purge3d", "Last 3 days")}</option>
          <option value={7}>{t("discord.members.modal.purge7d", "Last 7 days")}</option>
        </select>
      </div>
      <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "0.75rem" }}>
        <button onClick={onClose} className="btn btn-secondary btn-sm">{t("common.cancel", "Cancel")}</button>
        <button
          onClick={ban}
          disabled={saving}
          className="btn btn-primary btn-sm"
          style={{ background: "#dc2626", borderColor: "#dc2626" }}
        >
          {saving ? <Loader2 size={14} className="pl-spin" /> : <BanIcon size={14} />}
          {" "}{t("discord.members.modal.banConfirm", "Ban")}
        </button>
      </div>
    </ModalShell>
  );
}

// ── Shared modal shell (kept local so AccountsTab and MembersTab can
//    diverge styling later without touching each other). ──────────────────

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
