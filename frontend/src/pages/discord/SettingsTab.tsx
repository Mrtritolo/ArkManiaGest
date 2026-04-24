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
  KeyRound, Bot, Star, Users as UsersIcon, RotateCcw, Copy, RefreshCw,
} from "lucide-react";
import {
  discordApi,
  type DiscordConfigStatus, type DiscordConfigUpdate,
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
  admin_user_ids:    string;       // comma-separated
  operator_user_ids: string;
  viewer_user_ids:   string;
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
    admin_user_ids:    cfg.admin_user_ids.join(","),
    operator_user_ids: cfg.operator_user_ids.join(","),
    viewer_user_ids:   cfg.viewer_user_ids.join(","),
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

  // CSV lists -- send the parsed array when the textarea changed.
  function maybeList<K extends "admin_user_ids" | "operator_user_ids" | "viewer_user_ids">(
    key: K,
  ): void {
    if (form[key] !== initial[key]) {
      body[key] = form[key]
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);
    }
  }
  maybeList("admin_user_ids");
  maybeList("operator_user_ids");
  maybeList("viewer_user_ids");

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

      {/* Auto-promotion whitelists */}
      <Section
        title={t("discord.settings.section.whitelists", { defaultValue: "Auto-promotion whitelists" })}
        icon={<UsersIcon size={14} />}
      >
        <p style={{ fontSize: "0.78rem", color: "var(--text-secondary)", margin: "0 0 0.55rem 0" }}>
          {t(
            "discord.settings.whitelistsExplain",
            {
              defaultValue: "Comma-separated list of Discord IDs that get a 'discord:<id>' AppUser auto-created at the matching role on first Sign-in with Discord.  Edits override the previous list.",
            },
          )}
        </p>
        <ListField
          label={t("discord.settings.whitelist.admin", { defaultValue: "Admin" })}
          value={form.admin_user_ids}
          onChange={v => setForm({ ...form, admin_user_ids: v })}
        />
        <ListField
          label={t("discord.settings.whitelist.operator", { defaultValue: "Operator" })}
          value={form.operator_user_ids}
          onChange={v => setForm({ ...form, operator_user_ids: v })}
        />
        <ListField
          label={t("discord.settings.whitelist.viewer", { defaultValue: "Viewer" })}
          value={form.viewer_user_ids}
          onChange={v => setForm({ ...form, viewer_user_ids: v })}
        />
      </Section>

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

function ListField({
  label, value, onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const count = value.split(",").map(s => s.trim()).filter(Boolean).length;
  return (
    <div className="form-group" style={{ margin: 0 }}>
      <label className="form-label" style={{ display: "flex", justifyContent: "space-between" }}>
        <span>{label}</span>
        <span style={{ color: "var(--text-secondary)", fontSize: "0.7rem" }}>
          {count} {count === 1 ? "ID" : "IDs"}
        </span>
      </label>
      <input
        className="form-input"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="123456789012345678,234567890123456789"
        style={{ fontFamily: "monospace" }}
      />
    </div>
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
