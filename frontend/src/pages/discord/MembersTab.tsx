/**
 * MembersTab.tsx — Settings -> Discord -> Guild members.
 *
 * Loads the guild member list from /api/v1/discord/guild/members and renders
 * one row per member with inline moderation actions:
 *
 *   - Assign role (a combobox in the row) / remove role (a chip action)
 *   - Send DM (dialog with a textarea, capped to Discord's 2 000-char limit)
 *   - Kick  / Ban (both confirmed; the ban dialog carries reason + purge)
 *
 * Every action that changes Discord state is confirmed or explicit, and a
 * failed dialog keeps what was typed so a transient 502 costs nothing.
 *
 * Pagination: Discord's /guild/members caps a single call at 1000. "Load
 * more" walks pages with after=<last_user_id>; the 100-row page size keeps
 * the table responsive on big guilds.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Ban as BanIcon,
  MessageSquare,
  Plus,
  RotateCw,
  Send,
  Shield,
  UserMinus,
  X,
} from "lucide-react";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Combobox,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  NotAvailable,
  Select,
  Spinner,
  Table,
  TableMessageRow,
  Textarea,
  useConfirm,
  useToast,
} from "../../components/ui";
import {
  discordApi,
  type DiscordGuildInfo,
  type DiscordGuildMember,
  type DiscordGuildRole,
} from "../../services/api";
import { extractError } from "../../utils/errors";
import { fmtDate } from "../../utils/format";
import { usePending } from "../../hooks/usePending";
import styles from "./DiscordTabs.module.css";

const PAGE_SIZE = 100;
const DM_MAX = 2000;

function avatarUrl(userId: string, hash: string | null): string | null {
  if (!hash) return null;
  // Animated avatars start with "a_"; use .gif for those, .png otherwise.
  const ext = hash.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${userId}/${hash}.${ext}?size=64`;
}

/** Discord role colour (decimal RGB int) as a CSS colour; 0 = no override. */
function roleSwatch(color: number): string {
  return color ? `#${color.toString(16).padStart(6, "0")}` : "var(--color-text-muted)";
}

function memberName(m: DiscordGuildMember): string {
  return m.global_name || m.nick || m.username || m.user_id;
}

export default function MembersTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const pending = usePending<string>();

  const [guild, setGuild] = useState<DiscordGuildInfo | null>(null);
  const [roles, setRoles] = useState<DiscordGuildRole[]>([]);
  const [members, setMembers] = useState<DiscordGuildMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");

  // Dialogs and the one open role picker.
  const [dmFor, setDmFor] = useState<DiscordGuildMember | null>(null);
  const [banFor, setBanFor] = useState<DiscordGuildMember | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [roleQuery, setRoleQuery] = useState("");

  useEffect(() => {
    void loadAll();
    // Mount only: the tab is remounted when the operator returns to it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      setError(extractError(err, t("discord.members.errors.load")));
    } finally {
      setLoading(false);
    }
  }

  async function loadMore(): Promise<void> {
    const last = members[members.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const res = await discordApi.guildMembers({ limit: PAGE_SIZE, after: last.user_id });
      setMembers((prev) => [...prev, ...res.data]);
      setHasMore(res.data.length >= PAGE_SIZE);
    } catch (err: unknown) {
      toast.error(extractError(err, t("discord.members.errors.loadMore")));
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleAssignRole(userId: string, role: DiscordGuildRole): Promise<void> {
    setPickerFor(null);
    setRoleQuery("");
    await pending.run(`${userId}:role`, async () => {
      try {
        await discordApi.assignRole(userId, role.id);
        toast.success(t("discord.members.toast.roleAssigned"));
        // Update the local row in place so the chip appears immediately
        // without a full reload.
        setMembers((prev) =>
          prev.map((m) =>
            m.user_id === userId ? { ...m, roles: Array.from(new Set([...m.roles, role.id])) } : m,
          ),
        );
      } catch (err: unknown) {
        toast.error(extractError(err, t("discord.members.errors.assignRole")));
      }
    });
  }

  async function handleRemoveRole(m: DiscordGuildMember, role: DiscordGuildRole): Promise<void> {
    // One click used to strip a role (and with it VIP sync state) silently.
    const ok = await confirm({
      title: t("discord.members.confirmRemoveRoleTitle"),
      description: t("discord.members.confirmRemoveRoleBody", {
        role: role.name,
        user: memberName(m),
      }),
      confirmLabel: t("discord.members.removeRoleConfirm"),
      tone: "danger",
    });
    if (!ok) return;
    await pending.run(`${m.user_id}:role`, async () => {
      try {
        await discordApi.removeRole(m.user_id, role.id);
        toast.success(t("discord.members.toast.roleRemoved"));
        setMembers((prev) =>
          prev.map((x) =>
            x.user_id === m.user_id ? { ...x, roles: x.roles.filter((r) => r !== role.id) } : x,
          ),
        );
      } catch (err: unknown) {
        toast.error(extractError(err, t("discord.members.errors.removeRole")));
      }
    });
  }

  async function handleKick(m: DiscordGuildMember): Promise<void> {
    const ok = await confirm({
      title: t("discord.members.confirmKickTitle"),
      description: t("discord.members.confirmKick", { u: memberName(m) }),
      confirmLabel: t("discord.members.action.kick"),
      tone: "danger",
    });
    if (!ok) return;
    await pending.run(`${m.user_id}:kick`, async () => {
      try {
        await discordApi.kickMember(m.user_id);
        toast.success(t("discord.members.toast.kicked"));
        setMembers((prev) => prev.filter((x) => x.user_id !== m.user_id));
      } catch (err: unknown) {
        toast.error(extractError(err, t("discord.members.errors.kick")));
      }
    });
  }

  return (
    <div className="l-stack">
      {error && (
        <Alert
          tone="danger"
          title={t("discord.members.errors.load")}
          actions={
            <Button size="sm" icon={RotateCw} onClick={() => void loadAll()}>
              {t("common.retry")}
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      <Card
        title={guild?.name ?? t("discord.members.banner.loading")}
        actions={
          <Button size="sm" icon={RotateCw} onClick={() => void loadAll()}>
            {t("common.refresh")}
          </Button>
        }
      >
        <div className={styles.guildRow}>
          <Avatar
            name={guild?.name ?? "?"}
            src={
              guild?.icon
                ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=64`
                : null
            }
          />
          <span className="u-secondary u-text-sm">
            {guild
              ? t("discord.members.banner.counts", {
                  m: guild.approximate_member_count ?? "?",
                  p: guild.approximate_presence_count ?? "?",
                })
              : t("discord.members.banner.loading")}
          </span>
        </div>
      </Card>

      <Card
        title={t("discord.members.listTitle")}
        flush
        footer={
          hasMore ? (
            <Button
              icon={Plus}
              loading={loadingMore}
              loadingLabel={t("discord.members.loadingMore")}
              onClick={() => void loadMore()}
            >
              {t("discord.members.loadMore")}
            </Button>
          ) : undefined
        }
      >
        <Table label={t("discord.members.listTitle")} minWidth={860}>
          <thead>
            <tr>
              <th scope="col">{t("discord.members.col.user")}</th>
              <th scope="col">{t("discord.members.col.roles")}</th>
              <th scope="col">{t("discord.members.col.joined")}</th>
              <th scope="col">
                <span className="u-sr-only">{t("discord.members.col.actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <TableMessageRow colSpan={4}>
                <Spinner block label={t("discord.members.loading")} />
              </TableMessageRow>
            ) : members.length === 0 ? (
              <TableMessageRow colSpan={4}>
                <EmptyState
                  icon={Shield}
                  title={t("discord.members.emptyTitle")}
                  description={t("discord.members.empty")}
                />
              </TableMessageRow>
            ) : (
              members.map((m) => (
                <MemberRow
                  key={m.user_id}
                  member={m}
                  roles={roles}
                  busy={pending.isPending(`${m.user_id}:role`)}
                  kicking={pending.isPending(`${m.user_id}:kick`)}
                  pickerOpen={pickerFor === m.user_id}
                  roleQuery={pickerFor === m.user_id ? roleQuery : ""}
                  onRoleQueryChange={setRoleQuery}
                  onTogglePicker={() => {
                    setRoleQuery("");
                    setPickerFor((p) => (p === m.user_id ? null : m.user_id));
                  }}
                  onAssignRole={(role) => void handleAssignRole(m.user_id, role)}
                  onRemoveRole={(role) => void handleRemoveRole(m, role)}
                  onKick={() => void handleKick(m)}
                  onBan={() => setBanFor(m)}
                  onDm={() => setDmFor(m)}
                />
              ))
            )}
          </tbody>
        </Table>
      </Card>

      <DmModal
        member={dmFor}
        onClose={() => setDmFor(null)}
        onSent={() => {
          setDmFor(null);
          toast.success(t("discord.members.toast.dmSent"));
        }}
      />
      <BanModal
        member={banFor}
        onClose={() => setBanFor(null)}
        onBanned={(member) => {
          setBanFor(null);
          toast.success(t("discord.members.toast.banned"));
          setMembers((prev) => prev.filter((x) => x.user_id !== member.user_id));
        }}
      />
    </div>
  );
}

// ── Per-member row ───────────────────────────────────────────────────────────

interface MemberRowProps {
  member: DiscordGuildMember;
  roles: DiscordGuildRole[];
  busy: boolean;
  kicking: boolean;
  pickerOpen: boolean;
  roleQuery: string;
  onRoleQueryChange: (value: string) => void;
  onTogglePicker: () => void;
  onAssignRole: (role: DiscordGuildRole) => void;
  onRemoveRole: (role: DiscordGuildRole) => void;
  onKick: () => void;
  onBan: () => void;
  onDm: () => void;
}

function MemberRow({
  member,
  roles,
  busy,
  kicking,
  pickerOpen,
  roleQuery,
  onRoleQueryChange,
  onTogglePicker,
  onAssignRole,
  onRemoveRole,
  onKick,
  onBan,
  onDm,
}: MemberRowProps) {
  const { t } = useTranslation();
  const display = memberName(member);
  const rolePickerRef = useRef<HTMLInputElement>(null);

  // Opening the picker moves focus into it, so the role list appears at once
  // for the pointer and the keyboard alike.
  useEffect(() => {
    if (pickerOpen) rolePickerRef.current?.focus();
  }, [pickerOpen]);

  // Pre-index role lookup for O(1) per-tag rendering.
  const rolesById = useMemo(() => {
    const map = new Map<string, DiscordGuildRole>();
    for (const r of roles) map.set(r.id, r);
    return map;
  }, [roles]);

  // Roles already assigned to this member -- shown as removable chips.
  const assigned = member.roles
    .map((id) => rolesById.get(id))
    .filter((r): r is DiscordGuildRole => Boolean(r))
    .sort((a, b) => b.position - a.position);

  // Roles NOT yet assigned -- the picker offers these.  We strip the
  // @everyone role (always present, can't be assigned) and managed roles
  // (controlled by integrations like Twitch / Patreon).
  const assignable = roles.filter(
    (r) => !member.roles.includes(r.id) && r.name !== "@everyone" && !r.managed,
  );
  const query = roleQuery.trim().toLowerCase();
  const options = (query ? assignable.filter((r) => r.name.toLowerCase().includes(query)) : assignable).slice(
    0,
    50,
  );

  return (
    <tr>
      <td>
        <div className={styles.identity}>
          <Avatar name={display} src={avatarUrl(member.user_id, member.avatar)} size="sm" />
          <span className="ui-cell-2">
            <span>{display}</span>
            <span>{member.username ? `@${member.username}` : member.user_id}</span>
          </span>
        </div>
      </td>

      <td>
        <div className={styles.chips}>
          {assigned.map((r) => (
            <span key={r.id} className={styles.chip}>
              <Badge icon={Shield}>{r.name}</Badge>
              <IconButton
                size="sm"
                icon={X}
                tone="danger"
                disabled={busy}
                label={t("discord.members.removeRoleFrom", { role: r.name, user: display })}
                onClick={() => onRemoveRole(r)}
              />
            </span>
          ))}
          <IconButton
            size="sm"
            icon={Plus}
            label={t("discord.members.assignRoleTo", { user: display })}
            aria-expanded={pickerOpen}
            loading={busy}
            onClick={onTogglePicker}
          />
          {pickerOpen && (
            <Combobox
              size="sm"
              className={styles.rolePicker}
              label={t("discord.members.assignRoleTo", { user: display })}
              placeholder={t("discord.members.rolePickerPlaceholder")}
              inputRef={rolePickerRef}
              inputValue={roleQuery}
              onInputChange={onRoleQueryChange}
              options={options}
              emptyText={t("discord.members.popover.noRoles")}
              getKey={(r) => r.id}
              renderOption={(r) => (
                <span className={styles.roleOption}>
                  {/* Data-driven colour: the role's own swatch (MASTER §9). */}
                  <span className={styles.swatch} style={{ background: roleSwatch(r.color) }} />
                  {r.name}
                </span>
              )}
              onSelect={onAssignRole}
            />
          )}
        </div>
      </td>

      <td className="u-secondary">
        {member.joined_at ? fmtDate(member.joined_at) : <NotAvailable />}
      </td>

      <td>
        <div className="ui-row-actions">
          <IconButton
            size="sm"
            icon={MessageSquare}
            label={t("discord.members.dmTo", { user: display })}
            onClick={onDm}
          />
          <IconButton
            size="sm"
            icon={UserMinus}
            loading={kicking}
            label={t("discord.members.kickUser", { user: display })}
            onClick={onKick}
          />
          <IconButton
            size="sm"
            icon={BanIcon}
            tone="danger"
            label={t("discord.members.banUser", { user: display })}
            onClick={onBan}
          />
        </div>
      </td>
    </tr>
  );
}

// ── DM dialog ────────────────────────────────────────────────────────────────

function DmModal({
  member,
  onClose,
  onSent,
}: {
  member: DiscordGuildMember | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const { t } = useTranslation();
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const remaining = DM_MAX - content.length;

  // A new recipient starts from an empty draft; a failed send keeps the text.
  useEffect(() => {
    if (member) {
      setContent("");
      setError("");
    }
  }, [member]);

  async function send(): Promise<void> {
    const body = content.trim();
    if (!member || !body || saving) return;
    setSaving(true);
    setError("");
    try {
      await discordApi.dmUser(member.user_id, body);
      onSent();
    } catch (err: unknown) {
      // The dialog stays open with the message intact: a 429/502 from
      // Discord must not cost the operator a 2 000-character draft.
      setError(extractError(err, t("discord.members.errors.dm")));
    } finally {
      setSaving(false);
    }
  }

  const display = member ? memberName(member) : "";

  return (
    <Modal
      open={member !== null}
      onClose={onClose}
      dismissible={!saving}
      title={t("discord.members.modal.dmTitle", { u: display })}
      onSubmit={() => void send()}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            variant="primary"
            icon={Send}
            loading={saving}
            loadingLabel={t("discord.members.modal.dmSending")}
            disabled={!content.trim()}
          >
            {t("discord.members.modal.dmSend")}
          </Button>
        </>
      }
    >
      <div className="l-stack">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field
          label={t("discord.members.modal.message")}
          hint={t("discord.members.modal.remaining", { n: remaining, max: DM_MAX })}
        >
          <Textarea
            rows={6}
            value={content}
            placeholder={t("discord.members.modal.dmPh")}
            onChange={(event) => setContent(event.target.value.slice(0, DM_MAX))}
          />
        </Field>
      </div>
    </Modal>
  );
}

// ── Ban dialog ───────────────────────────────────────────────────────────────

function BanModal({
  member,
  onClose,
  onBanned,
}: {
  member: DiscordGuildMember | null;
  onClose: () => void;
  onBanned: (member: DiscordGuildMember) => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [purgeDays, setPurgeDays] = useState(0); // 0..7
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (member) {
      setReason("");
      setPurgeDays(0);
      setError("");
    }
  }, [member]);

  async function ban(): Promise<void> {
    if (!member || saving) return;
    setSaving(true);
    setError("");
    try {
      await discordApi.banMember(member.user_id, {
        reason: reason.trim() || undefined,
        delete_message_seconds: purgeDays * 86400,
      });
      onBanned(member);
    } catch (err: unknown) {
      setError(extractError(err, t("discord.members.errors.ban")));
    } finally {
      setSaving(false);
    }
  }

  const display = member ? memberName(member) : "";

  return (
    <Modal
      open={member !== null}
      onClose={onClose}
      dismissible={!saving}
      title={t("discord.members.modal.banTitle", { u: display })}
      description={t("discord.members.modal.banWarning")}
      onSubmit={() => void ban()}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            variant="danger"
            icon={BanIcon}
            loading={saving}
            loadingLabel={t("discord.members.modal.banning")}
          >
            {t("discord.members.modal.banConfirm")}
          </Button>
        </>
      }
    >
      <div className="l-stack">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label={t("discord.members.modal.reason")}>
          <Input
            maxLength={512}
            value={reason}
            placeholder={t("discord.members.modal.reasonPh")}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <Field label={t("discord.members.modal.purge")}>
          <Select value={purgeDays} onChange={(event) => setPurgeDays(Number(event.target.value))}>
            <option value={0}>{t("discord.members.modal.purgeNone")}</option>
            <option value={1}>{t("discord.members.modal.purge1d")}</option>
            <option value={3}>{t("discord.members.modal.purge3d")}</option>
            <option value={7}>{t("discord.members.modal.purge7d")}</option>
          </Select>
        </Field>
      </div>
    </Modal>
  );
}
