/**
 * SettingsTab.tsx — Settings -> Discord -> Modifica.
 *
 * Edit the DISCORD_* keys directly from the panel (writes to the
 * backend's `.env` via PUT /api/v1/discord/config) so an admin doesn't
 * have to SSH into the host to rotate a token / change a role ID.
 *
 * Pydantic loads .env once at boot, so any change here only takes
 * effect after a service restart.  The page surfaces a restart hint
 * the operator can copy-paste after a successful save.
 *
 * Field semantics (matches the backend's per-field behaviour):
 *   - non-secret fields (client_id, public_key, guild_id, redirect_uri,
 *     vip_role_id):  current value pre-filled from /discord/config; an
 *     empty input clears the value, a non-empty input writes it.
 *   - secret fields (client_secret, bot_token):  rendered as a password
 *     input, current value NEVER returned by the backend; an empty
 *     input MEANS 'leave unchanged' (NOT 'clear').  An explicit
 *     'Clear secret' button flips the field into clear-mode.
 *   - whitelist fields:  a textarea of comma-separated IDs; any change
 *     replaces the whole list.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Loader2, AlertCircle, CheckCircle, Save, Eye, EyeOff,
  KeyRound, Bot, Star, RotateCcw, Copy, RefreshCw,
  Plus, Trash2, ArrowDownUp, Link as LinkIcon,
} from "lucide-react";
import {
  discordApi,
  type DiscordConfigStatus, type DiscordConfigUpdate,
  type DiscordGuildRole, type RoleMapping, type RoleSyncReport,
} from "../../services/api";

// ── Helpers ─────────────────────────────────────────────────────────────────

function extractError(err: unknown, fallback: string): string {
  const msg =
    (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
    ?? (err as { message?: string })?.message
    ?? fallback;
  return typeof msg === "string" ? msg : fallback;
}

async function copyText(text: string): Promise<void> {
  try { await navigator.clipboard.writeText(text); } catch { /* best-effort */ }
}

// ── Local form state ────────────────────────────────────────────────────────

interface FormState {
  client_id:         string;
  client_secret:     string;       // empty + secretMode='keep' = leave alone
  client_secret_mode: "keep" | "set" | "clear";
  bot_token:         string;
  bot_token_mode:    "keep" | "set" | "clear";
  public_key:        string;
  guild_id:          string;
  redirect_uri:      string;
  vip_role_id:       string;
}

function makeInitialForm(cfg: DiscordConfigStatus): FormState {
  return {
    client_id:         cfg.client_id || "",
    client_secret:     "",
    client_secret_mode:"keep",
    bot_token:         "",
    bot_token_mode:    "keep",
    public_key:        cfg.public_key || "",
    guild_id:          cfg.guild_id || "",
    redirect_uri:      cfg.redirect_uri || "",
    vip_role_id:       cfg.vip_role_id || "",
  };
}

function buildUpdateBody(form: FormState, initial: FormState): DiscordConfigUpdate {
  const body: DiscordConfigUpdate = {};

  // String fields: send only when changed.
  function maybe<K extends "client_id" | "public_key" | "guild_id" | "redirect_uri" | "vip_role_id">(
    key: K,
  ): void {
    if (form[key] !== initial[key]) body[key] = form[key];
  }
  maybe("client_id");
  maybe("public_key");
  maybe("guild_id");
  maybe("redirect_uri");
  maybe("vip_role_id");

  // Secret fields: governed by mode.
  if (form.client_secret_mode === "set" && form.client_secret.length > 0) {
    body.client_secret = form.client_secret;
  } else if (form.client_secret_mode === "clear") {
    body.client_secret = "";
  }
  if (form.bot_token_mode === "set" && form.bot_token.length > 0) {
    body.bot_token = form.bot_token;
  } else if (form.bot_token_mode === "clear") {
    body.bot_token = "";
  }

  // The OAuth admin/operator/viewer whitelists were removed in Phase 7+.
  // The body now never carries them, so the backend leaves whatever it had
  // in .env untouched (the per-key 'null = leave alone' semantics).
  return body;
}

// ── Component ───────────────────────────────────────────────────────────────

export default function SettingsTab() {
  const { t } = useTranslation();

  const [config, setConfig]   = useState<DiscordConfigStatus | null>(null);
  const [initial, setInitial] = useState<FormState | null>(null);
  const [form, setForm]       = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState("");
  const [success, setSuccess] = useState<{ updatedKeys: string[]; hint: string } | null>(null);
  const [showClientSecret, setShowClientSecret] = useState(false);
  const [showBotToken,     setShowBotToken]     = useState(false);

  useEffect(() => { load(); }, []);

  async function load(): Promise<void> {
    setLoading(true);
    setError("");
    setSuccess(null);
    try {
      const res = await discordApi.config();
      setConfig(res.data);
      const init = makeInitialForm(res.data);
      setInitial(init);
      setForm(init);
    } catch (err: unknown) {
      setError(extractError(err, t(
        "discord.settings.errors.load",
        { defaultValue: "Failed to load Discord configuration." },
      )));
    } finally {
      setLoading(false);
    }
  }

  async function save(): Promise<void> {
    if (!form || !initial) return;
    const body = buildUpdateBody(form, initial);
    if (Object.keys(body).length === 0) {
      setError(t(
        "discord.settings.noChanges",
        { defaultValue: "No changes to save." },
      ));
      return;
    }
    setSaving(true);
    setError("");
    setSuccess(null);
    try {
      const res = await discordApi.updateConfig(body);
      setSuccess({ updatedKeys: res.data.updated_keys, hint: res.data.restart_hint });
      // IMPORTANT: do NOT re-fetch /discord/config here.  Pydantic loads
      // .env only at boot, so a re-fetch right now would return the OLD
      // in-memory values (the server hasn't restarted yet) and would
      // VISUALLY revert the form to its pre-save state -- making the
      // operator think 'nothing happened' even though the file IS
      // correctly updated.  Instead, update the local 'initial' baseline
      // to match what we just sent, so the form stays consistent and
      // hasChanges flips to false (the green 'restart required' banner
      // is the visible signal that more is needed).  Secret fields are
      // also reset to 'keep' mode so the password inputs clear without
      // looking like they got wiped.
      const newInitial: FormState = {
        ...form,
        client_secret:      "",
        client_secret_mode: "keep",
        bot_token:          "",
        bot_token_mode:     "keep",
      };
      setForm(newInitial);
      setInitial(newInitial);
    } catch (err: unknown) {
      setError(extractError(err, t(
        "discord.settings.errors.save",
        { defaultValue: "Failed to save Discord configuration." },
      )));
    } finally {
      setSaving(false);
    }
  }

  function reset(): void {
    if (initial) setForm(initial);
    setSuccess(null);
    setError("");
  }

  const hasChanges = useMemo(() => {
    if (!form || !initial) return false;
    return Object.keys(buildUpdateBody(form, initial)).length > 0;
  }, [form, initial]);

  if (loading || !form || !config) {
    return (
      <div className="pl-loading">
        <Loader2 size={20} className="pl-spin" />{" "}
        {t("discord.settings.loading", { defaultValue: "Loading Discord configuration…" })}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {error && (
        <div className="alert alert-error">
          <AlertCircle size={14} /> {error}
        </div>
      )}
      {success && (
        <div className="alert alert-success" style={{ flexDirection: "column", alignItems: "flex-start" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <CheckCircle size={14} />
            {t(
              "discord.settings.savedKeys",
              {
                defaultValue: "{{n}} keys updated: {{keys}}",
                n: success.updatedKeys.length,
                keys: success.updatedKeys.join(", "),
              },
            )}
          </div>
          <div style={{
            marginTop: "0.5rem", fontSize: "0.78rem",
            display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap",
          }}>
            <span>
              {t(
                "discord.settings.restartHint",
                { defaultValue: "Pydantic loads .env at boot -- restart the service to activate the changes:" },
              )}
            </span>
            <code style={{
              background: "var(--bg-card-muted, #f5f5f7)",
              padding: "0.15rem 0.4rem", borderRadius: 4,
              fontFamily: "monospace",
            }}>
              {success.hint}
            </code>
            <button
              onClick={() => copyText(success.hint)}
              className="btn btn-secondary btn-sm"
              style={{ padding: "0.15rem 0.35rem" }}
              title={t("discord.config.toast.copied", { defaultValue: "Copy" })}
            >
              <Copy size={11} />
            </button>
          </div>
        </div>
      )}

      {/* OAuth credentials */}
      <Section
        title={t("discord.settings.section.oauth", { defaultValue: "OAuth credentials" })}
        icon={<KeyRound size={14} />}
      >
        <Field
          label={t("discord.settings.field.clientId", { defaultValue: "Client ID" })}
          value={form.client_id}
          onChange={v => setForm({ ...form, client_id: v })}
          monospace
        />
        <SecretField
          label={t("discord.settings.field.clientSecret", { defaultValue: "Client secret" })}
          present={config.has_client_secret}
          mode={form.client_secret_mode}
          value={form.client_secret}
          show={showClientSecret}
          onToggleShow={() => setShowClientSecret(s => !s)}
          onModeChange={mode => setForm({ ...form, client_secret_mode: mode, client_secret: mode === "set" ? form.client_secret : "" })}
          onChange={v => setForm({ ...form, client_secret: v, client_secret_mode: "set" })}
        />
        <Field
          label={t("discord.settings.field.publicKey", { defaultValue: "Public key" })}
          value={form.public_key}
          onChange={v => setForm({ ...form, public_key: v })}
          monospace
        />
        <Field
          label={t("discord.settings.field.redirectUri", { defaultValue: "Redirect URI" })}
          value={form.redirect_uri}
          onChange={v => setForm({ ...form, redirect_uri: v })}
          monospace
          hint={t(
            "discord.settings.hint.redirectUri",
            { defaultValue: "Must match EXACTLY the URI registered on the Discord Developer Portal -> OAuth2 -> Redirects." },
          )}
        />
      </Section>

      {/* Bot credentials */}
      <Section
        title={t("discord.settings.section.bot", { defaultValue: "Discord bot" })}
        icon={<Bot size={14} />}
      >
        <SecretField
          label={t("discord.settings.field.botToken", { defaultValue: "Bot token" })}
          present={config.has_bot_token}
          mode={form.bot_token_mode}
          value={form.bot_token}
          show={showBotToken}
          onToggleShow={() => setShowBotToken(s => !s)}
          onModeChange={mode => setForm({ ...form, bot_token_mode: mode, bot_token: mode === "set" ? form.bot_token : "" })}
          onChange={v => setForm({ ...form, bot_token: v, bot_token_mode: "set" })}
        />
        <Field
          label={t("discord.settings.field.guildId", { defaultValue: "Guild ID" })}
          value={form.guild_id}
          onChange={v => setForm({ ...form, guild_id: v })}
          monospace
          hint={t(
            "discord.settings.hint.guildId",
            { defaultValue: "Right-click the server name on Discord (with Developer Mode enabled) -> Copy Server ID." },
          )}
        />
      </Section>

      {/* VIP sync */}
      <Section
        title={t("discord.settings.section.vipSync", { defaultValue: "VIP sync" })}
        icon={<Star size={14} />}
      >
        <Field
          label={t("discord.settings.field.vipRoleId", { defaultValue: "VIP role ID" })}
          value={form.vip_role_id}
          onChange={v => setForm({ ...form, vip_role_id: v })}
          monospace
          hint={t(
            "discord.settings.hint.vipRoleId",
            { defaultValue: "Discord snowflake of the role mirrored from the ARK plugin DB.  Right-click the role -> Copy Role ID (Developer Mode required)." },
          )}
        />
      </Section>

      {/* Discord role -> ARK group mapping (Phase 7+) */}
      <RoleMappingSection />

      {/* Action bar */}
      <div style={{
        display: "flex", justifyContent: "space-between",
        alignItems: "center", gap: "0.5rem",
        padding: "0.6rem 0", borderTop: "1px solid var(--border)",
      }}>
        <button onClick={() => load()} className="btn btn-secondary btn-sm">
          <RefreshCw size={12} />{" "}
          {t("common.refresh", { defaultValue: "Refresh" })}
        </button>
        <div style={{ display: "flex", gap: "0.4rem" }}>
          <button
            onClick={reset}
            disabled={!hasChanges || saving}
            className="btn btn-secondary btn-sm"
          >
            <RotateCcw size={12} />{" "}
            {t("discord.settings.reset", { defaultValue: "Reset" })}
          </button>
          <button
            onClick={save}
            disabled={!hasChanges || saving}
            className="btn btn-primary btn-sm"
            title={!hasChanges
              ? t("discord.settings.saveDisabledNoChanges",
                  { defaultValue: "No pending changes to save" })
              : t("discord.settings.save", { defaultValue: "Save changes" })}
          >
            {saving ? <Loader2 size={12} className="pl-spin" /> : <Save size={12} />}
            {" "}
            {hasChanges
              ? t("discord.settings.save", { defaultValue: "Save changes" })
              : t("discord.settings.saveNothing", { defaultValue: "No changes" })}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Layout primitives ───────────────────────────────────────────────────────

function Section({
  title, icon, children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="pl-sync-panel">
      <div className="pl-sync-header">
        <span className="pl-sync-title" style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          {icon} {title}
        </span>
      </div>
      <div className="pl-sync-body" style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {children}
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, hint, monospace,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  monospace?: boolean;
}) {
  return (
    <div className="form-group" style={{ margin: 0 }}>
      <label className="form-label">{label}</label>
      <input
        className="form-input"
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ fontFamily: monospace ? "monospace" : undefined }}
      />
      {hint && (
        <div style={{ fontSize: "0.7rem", color: "var(--text-secondary)", marginTop: 2 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

// ── Role-mapping section (Phase 7+) ──────────────────────────────────────────

function RoleMappingSection() {
  const { t } = useTranslation();
  const [mappings, setMappings] = useState<RoleMapping[] | null>(null);
  const [roles, setRoles]       = useState<DiscordGuildRole[]>([]);
  const [loading, setLoading]   = useState(true);
  const [savingIds, setSavingIds] = useState<Set<number>>(new Set());
  const [creating, setCreating]   = useState(false);
  const [syncing, setSyncing]     = useState(false);
  const [syncReport, setSyncReport] = useState<RoleSyncReport | null>(null);
  const [error, setError]       = useState("");

  // New-row draft (kept local so typing doesn't yet hit the backend)
  const [draftRole, setDraftRole]   = useState("");
  const [draftGroup, setDraftGroup] = useState("");

  useEffect(() => { load(); }, []);

  async function load(): Promise<void> {
    setLoading(true);
    setError("");
    try {
      const [m, r] = await Promise.all([
        discordApi.listRoleMappings(),
        discordApi.guildRoles().catch(() => ({ data: [] as DiscordGuildRole[] })),
      ]);
      setMappings(m.data);
      setRoles(r.data);
    } catch (err: unknown) {
      setError(extractError(err, t("discord.roleMap.errors.load", {
        defaultValue: "Failed to load role mappings.",
      })));
    } finally {
      setLoading(false);
    }
  }

  async function createMapping(): Promise<void> {
    const role = draftRole.trim();
    const grp  = draftGroup.trim();
    if (!role || !grp) {
      setError(t("discord.roleMap.errors.required", {
        defaultValue: "Select a Discord role AND type the ARK group name.",
      }));
      return;
    }
    setCreating(true);
    setError("");
    try {
      const guildRole = roles.find(r => r.id === role);
      await discordApi.createRoleMapping({
        discord_role_id:   role,
        discord_role_name: guildRole?.name,
        ark_group_name:    grp,
        is_active:         true,
      });
      setDraftRole("");
      setDraftGroup("");
      await load();
    } catch (err: unknown) {
      setError(extractError(err, t("discord.roleMap.errors.create", {
        defaultValue: "Failed to create mapping.",
      })));
    } finally {
      setCreating(false);
    }
  }

  async function patch(id: number, body: Partial<RoleMapping>): Promise<void> {
    const next = new Set(savingIds); next.add(id); setSavingIds(next);
    try {
      await discordApi.updateRoleMapping(id, body);
      setMappings(prev => prev?.map(m => m.id === id ? { ...m, ...body } : m) ?? null);
    } catch (err: unknown) {
      setError(extractError(err, t("discord.roleMap.errors.update", {
        defaultValue: "Failed to update mapping.",
      })));
    } finally {
      const after = new Set(savingIds); after.delete(id); setSavingIds(after);
    }
  }

  async function del(id: number): Promise<void> {
    if (!confirm(t("discord.roleMap.confirmDelete", {
      defaultValue: "Delete this mapping?",
    }))) return;
    try {
      await discordApi.deleteRoleMapping(id);
      setMappings(prev => prev?.filter(m => m.id !== id) ?? null);
    } catch (err: unknown) {
      setError(extractError(err, t("discord.roleMap.errors.delete", {
        defaultValue: "Failed to delete mapping.",
      })));
    }
  }

  async function runSync(): Promise<void> {
    setSyncing(true);
    setError("");
    setSyncReport(null);
    try {
      const res = await discordApi.syncRoles();
      setSyncReport(res.data);
    } catch (err: unknown) {
      setError(extractError(err, t("discord.roleMap.errors.sync", {
        defaultValue: "Sync failed.",
      })));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <Section
      title={t("discord.roleMap.title", { defaultValue: "Sincronizzazione ruoli (Discord -> ARK)" })}
      icon={<LinkIcon size={14} />}
    >
      <p style={{ fontSize: "0.78rem", color: "var(--text-secondary)", margin: "0 0 0.55rem 0" }}>
        {t("discord.roleMap.explain", {
          defaultValue: "Ogni regola dice: chi ha il ruolo Discord X riceve il gruppo permessi Y nel DB plugin (Players.PermissionGroups).  Il motore di sync NON tocca gruppi non gestiti da regole attive: la VIP-sync (env DISCORD_VIP_ROLE_ID) e i gruppi admin/custom passano intatti.",
        })}
      </p>

      {error && (
        <div className="alert alert-error" style={{ marginBottom: "0.5rem" }}>
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {/* Existing rules */}
      {loading ? (
        <div className="pl-loading"><Loader2 size={16} className="pl-spin" /></div>
      ) : (mappings && mappings.length > 0) ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
          {mappings.map(m => {
            const saving = savingIds.has(m.id);
            const guildRole = roles.find(r => r.id === m.discord_role_id);
            const roleLabel = guildRole?.name || m.discord_role_name || `(role ${m.discord_role_id})`;
            return (
              <div key={m.id} style={{
                display: "grid",
                gridTemplateColumns: "minmax(120px, 1fr) 24px minmax(100px, 1fr) auto auto",
                gap: "0.4rem", alignItems: "center",
                padding: "0.35rem 0.45rem",
                border: "1px solid var(--border)",
                borderRadius: 6,
                opacity: m.is_active ? 1 : 0.55,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", minWidth: 0 }}>
                  <span style={{
                    width: 10, height: 10, borderRadius: 99,
                    background: guildRole ? `#${(guildRole.color || 0x5865F2).toString(16).padStart(6, "0")}` : "#5865F2",
                    flexShrink: 0,
                  }} />
                  <span style={{ fontSize: "0.8rem", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {roleLabel}
                  </span>
                </div>
                <span style={{ textAlign: "center", color: "var(--text-secondary)" }}>→</span>
                <input
                  className="form-input"
                  value={m.ark_group_name}
                  onChange={e => setMappings(prev => prev?.map(x =>
                    x.id === m.id ? { ...x, ark_group_name: e.target.value } : x
                  ) ?? null)}
                  onBlur={e => {
                    const v = e.target.value.trim();
                    if (v && v !== m.ark_group_name) patch(m.id, { ark_group_name: v });
                  }}
                  style={{ fontFamily: "monospace", fontSize: "0.8rem", padding: "0.2rem 0.4rem" }}
                />
                <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.72rem", color: "var(--text-secondary)" }}>
                  <input
                    type="checkbox"
                    checked={m.is_active}
                    disabled={saving}
                    onChange={e => patch(m.id, { is_active: e.target.checked })}
                  />
                  {t("discord.roleMap.enabled", { defaultValue: "Attiva" })}
                </label>
                <button
                  onClick={() => del(m.id)}
                  className="btn btn-secondary btn-sm"
                  style={{ padding: "0.2rem 0.4rem", color: "#dc2626" }}
                  title={t("discord.roleMap.delete", { defaultValue: "Elimina" })}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)", padding: "0.4rem 0" }}>
          {t("discord.roleMap.empty", {
            defaultValue: "Nessuna regola configurata.  Aggiungine una qui sotto.",
          })}
        </div>
      )}

      {/* New row draft */}
      <div style={{
        marginTop: "0.6rem", display: "grid",
        gridTemplateColumns: "minmax(120px, 1fr) 24px minmax(100px, 1fr) auto",
        gap: "0.4rem", alignItems: "center",
        padding: "0.35rem 0.45rem",
        background: "var(--bg-card-muted, #f5f5f7)",
        borderRadius: 6,
      }}>
        <select
          value={draftRole}
          onChange={e => setDraftRole(e.target.value)}
          className="form-input"
          style={{ fontSize: "0.8rem", padding: "0.2rem 0.4rem" }}
        >
          <option value="">
            {roles.length === 0
              ? t("discord.roleMap.noRolesLoaded", { defaultValue: "(Bot non configurato -- nessun ruolo)" })
              : t("discord.roleMap.pickRole", { defaultValue: "Scegli un ruolo Discord…" })}
          </option>
          {roles.filter(r => r.name !== "@everyone" && !r.managed).map(r => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
        <span style={{ textAlign: "center", color: "var(--text-secondary)" }}>→</span>
        <input
          className="form-input"
          placeholder={t("discord.roleMap.groupPlaceholder", { defaultValue: "Nome gruppo ARK (es. VIP)" })}
          value={draftGroup}
          onChange={e => setDraftGroup(e.target.value)}
          style={{ fontFamily: "monospace", fontSize: "0.8rem", padding: "0.2rem 0.4rem" }}
        />
        <button
          onClick={createMapping}
          disabled={creating || !draftRole || !draftGroup.trim()}
          className="btn btn-primary btn-sm"
        >
          {creating ? <Loader2 size={12} className="pl-spin" /> : <Plus size={12} />}
          {" "}{t("discord.roleMap.add", { defaultValue: "Aggiungi" })}
        </button>
      </div>

      {/* Sync trigger + last report */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.8rem" }}>
        <button
          onClick={runSync}
          disabled={syncing || (mappings?.filter(m => m.is_active).length ?? 0) === 0}
          className="btn btn-primary btn-sm"
        >
          {syncing ? <Loader2 size={12} className="pl-spin" /> : <ArrowDownUp size={12} />}
          {" "}
          {syncing
            ? t("discord.roleMap.syncing", { defaultValue: "Sync in corso…" })
            : t("discord.roleMap.sync",    { defaultValue: "Sync ruoli ora" })}
        </button>
        {syncReport && (
          <span style={{ fontSize: "0.72rem", color: "var(--text-secondary)" }}>
            {t("discord.roleMap.lastRun", {
              defaultValue: "{{s}}s · {{n}} linked, {{c}} cambiati, {{e}} errori",
              s: syncReport.duration_seconds.toFixed(1),
              n: syncReport.linked_total,
              c: syncReport.players_changed,
              e: syncReport.error_count,
            })}
          </span>
        )}
      </div>

      {syncReport && syncReport.actions.length > 0 && (
        <details style={{ fontSize: "0.78rem", marginTop: "0.5rem" }}>
          <summary style={{ cursor: "pointer", color: "var(--text-secondary)" }}>
            {t("discord.roleMap.details", {
              defaultValue: "Dettaglio cambi ({{n}})",
              n: syncReport.actions.length,
            })}
          </summary>
          <div style={{ marginTop: "0.3rem", maxHeight: 280, overflowY: "auto" }}>
            {syncReport.actions.map((a, i) => (
              <div key={i} style={{
                padding: "0.25rem 0.45rem",
                borderBottom: "1px solid var(--border)",
                display: "flex", justifyContent: "space-between",
                color: a.error ? "#dc2626" : "var(--text)",
              }}>
                <span>
                  {a.player_name || a.eos_id.slice(0, 8) + "…"}
                  {a.groups_added.length > 0 && (
                    <span style={{ color: "#16a34a", marginLeft: 6 }}>
                      +{a.groups_added.join(",")}
                    </span>
                  )}
                  {a.groups_removed.length > 0 && (
                    <span style={{ color: "#d97706", marginLeft: 6 }}>
                      -{a.groups_removed.join(",")}
                    </span>
                  )}
                </span>
                {a.detail && <span style={{ color: "var(--text-secondary)" }}>{a.detail}</span>}
              </div>
            ))}
          </div>
        </details>
      )}
    </Section>
  );
}

function SecretField({
  label, present, mode, value, show,
  onToggleShow, onModeChange, onChange,
}: {
  label: string;
  present: boolean;
  mode: "keep" | "set" | "clear";
  value: string;
  show: boolean;
  onToggleShow: () => void;
  onModeChange: (mode: "keep" | "set" | "clear") => void;
  onChange: (v: string) => void;
}) {
  const { t } = useTranslation();
  const isCleared = mode === "clear";

  return (
    <div className="form-group" style={{ margin: 0 }}>
      <label className="form-label" style={{ display: "flex", justifyContent: "space-between" }}>
        <span>{label}</span>
        <span style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>
          {isCleared
            ? t("discord.settings.secret.willClear", { defaultValue: "(will be cleared on save)" })
            : present
              ? t("discord.settings.secret.set", { defaultValue: "(currently set)" })
              : t("discord.settings.secret.notSet", { defaultValue: "(not set)" })}
        </span>
      </label>
      <div style={{ display: "flex", gap: "0.3rem", alignItems: "stretch" }}>
        <input
          className="form-input"
          type={show ? "text" : "password"}
          value={isCleared ? "" : value}
          disabled={isCleared}
          onChange={e => onChange(e.target.value)}
          placeholder={
            present && !isCleared
              ? t("discord.settings.secret.placeholder", { defaultValue: "Leave empty to keep current value" })
              : ""
          }
          style={{ flex: 1, fontFamily: "monospace" }}
        />
        <button
          onClick={onToggleShow}
          className="btn btn-secondary btn-sm"
          style={{ padding: "0 0.5rem" }}
          type="button"
          title={show ? "Hide" : "Show"}
          disabled={isCleared}
        >
          {show ? <EyeOff size={12} /> : <Eye size={12} />}
        </button>
        {present && (
          isCleared ? (
            <button
              onClick={() => onModeChange("keep")}
              className="btn btn-secondary btn-sm"
              type="button"
            >
              {t("discord.settings.secret.undoClear", { defaultValue: "Undo clear" })}
            </button>
          ) : (
            <button
              onClick={() => onModeChange("clear")}
              className="btn btn-secondary btn-sm"
              type="button"
              style={{ color: "#dc2626" }}
              title={t("discord.settings.secret.clearTitle", { defaultValue: "Clear this secret on save" })}
            >
              {t("discord.settings.secret.clear", { defaultValue: "Clear" })}
            </button>
          )
        )}
      </div>
    </div>
  );
}
