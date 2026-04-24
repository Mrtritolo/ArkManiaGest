/**
 * ConfigTab.tsx — Settings -> Discord -> Configuration.
 *
 * Diagnostic-only view of the Discord integration's environment-driven
 * configuration.  Shows:
 *
 *   1. OAuth readiness   -- public Client ID + redirect URI + which .env
 *                           keys are still empty.
 *   2. Bot readiness     -- public guild ID + which .env keys are still
 *                           empty.  When populated, also surfaces the
 *                           bot's view of the guild (name + member count
 *                           + the GUILD_MEMBERS intent verdict).
 *   3. Auto-promotion whitelists -- the three CSV lists of Discord IDs
 *                                   that get an AppUser auto-created at
 *                                   admin/operator/viewer role on first
 *                                   Discord login.
 *
 * Editing happens at the .env layer (with a service restart).  This tab
 * is intentionally read-only -- a future feature can promote the
 * whitelists to the panel `arkmaniagest_settings` table for runtime
 * editing if/when the operator asks for it.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Loader2, AlertCircle, CheckCircle, RefreshCw,
  ShieldAlert, ShieldCheck, KeyRound, Bot, Users as UsersIcon, Copy,
} from "lucide-react";
import {
  discordApi,
  type DiscordConfigStatus, type DiscordGuildInfo,
} from "../../services/api";

function extractError(err: unknown, fallback: string): string {
  const msg =
    (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
    ?? (err as { message?: string })?.message
    ?? fallback;
  return typeof msg === "string" ? msg : fallback;
}

async function copy(text: string): Promise<void> {
  try { await navigator.clipboard.writeText(text); } catch { /* best-effort */ }
}

export default function ConfigTab() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<DiscordConfigStatus | null>(null);
  const [guild,  setGuild]  = useState<DiscordGuildInfo | null>(null);
  const [guildErr, setGuildErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const [copied, setCopied]   = useState("");

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(""), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  useEffect(() => { loadAll(); }, []);

  async function loadAll(): Promise<void> {
    setLoading(true);
    setError("");
    setGuildErr("");
    setGuild(null);
    try {
      const cfg = await discordApi.config();
      setConfig(cfg.data);
      // Only attempt the guild probe when bot creds look complete --
      // otherwise we'd 503 on every render.
      if (cfg.data.bot_ready) {
        try {
          const g = await discordApi.guildInfo();
          setGuild(g.data);
        } catch (err: unknown) {
          setGuildErr(extractError(
            err,
            t(
              "discord.config.errors.guildProbe",
              "Bot credentials are set but Discord rejected the guild lookup.",
            ),
          ));
        }
      }
    } catch (err: unknown) {
      setError(extractError(err, t("discord.config.errors.load", "Failed to load Discord configuration.")));
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="pl-loading">
        <Loader2 size={20} className="pl-spin" />{" "}
        {t("discord.config.loading", "Loading Discord configuration…")}
      </div>
    );
  }
  if (error || !config) {
    return (
      <div className="alert alert-error">
        <AlertCircle size={14} /> {error || "?"}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button onClick={loadAll} className="btn btn-secondary btn-sm">
          <RefreshCw size={12} /> {t("common.refresh", "Refresh")}
        </button>
      </div>

      {/* OAuth readiness */}
      <Section
        title={t("discord.config.section.oauth", "OAuth (Sign in with Discord)")}
        ready={config.oauth_ready}
        readyLabel={t("discord.config.ready.oauth", "Ready")}
        notReadyLabel={t("discord.config.notReady.oauth", "Not configured")}
        icon={<KeyRound size={14} />}
      >
        <KV label={t("discord.config.field.clientId", "Client ID")}
            value={config.client_id || "—"}
            onCopy={config.client_id ? () => { copy(config.client_id); setCopied("client_id"); } : undefined}
            copied={copied === "client_id"}
        />
        <KV label={t("discord.config.field.publicKey", "Public key")}
            value={config.public_key ? config.public_key.slice(0, 16) + "…" : "—"}
        />
        <KV label={t("discord.config.field.redirectUri", "Redirect URI")}
            value={config.redirect_uri || "—"}
            hint={!config.redirect_uri
              ? t("discord.config.hint.redirectMissing", "Set DISCORD_REDIRECT_URI in .env and restart the service.")
              : t("discord.config.hint.redirectRegister",
                  "This URI must be registered EXACTLY in Discord Developer Portal -> OAuth2 -> Redirects.")
            }
            onCopy={config.redirect_uri
              ? () => { copy(config.redirect_uri); setCopied("redirect_uri"); }
              : undefined}
            copied={copied === "redirect_uri"}
        />
        <KV label={t("discord.config.field.clientSecret", "Client secret")}
            value={config.has_client_secret
              ? t("discord.config.placeholder.set", "(set)")
              : t("discord.config.placeholder.notSet", "(not set)")}
        />
        {config.missing_for_oauth.length > 0 && (
          <MissingHint keys={config.missing_for_oauth} />
        )}
      </Section>

      {/* Bot readiness */}
      <Section
        title={t("discord.config.section.bot", "Discord bot")}
        ready={config.bot_ready}
        readyLabel={t("discord.config.ready.bot", "Ready")}
        notReadyLabel={t("discord.config.notReady.bot", "Not configured")}
        icon={<Bot size={14} />}
      >
        <KV label={t("discord.config.field.guildId", "Guild ID")}
            value={config.guild_id || "—"}
            onCopy={config.guild_id ? () => { copy(config.guild_id); setCopied("guild_id"); } : undefined}
            copied={copied === "guild_id"}
        />
        <KV label={t("discord.config.field.botToken", "Bot token")}
            value={config.has_bot_token
              ? t("discord.config.placeholder.set", "(set)")
              : t("discord.config.placeholder.notSet", "(not set)")}
        />
        {config.missing_for_bot.length > 0 && (
          <MissingHint keys={config.missing_for_bot} />
        )}

        {/* Live guild probe */}
        {config.bot_ready && (
          <div style={{ marginTop: "0.6rem" }}>
            {guildErr && (
              <div className="alert alert-error" style={{ marginBottom: 0 }}>
                <AlertCircle size={14} /> {guildErr}
              </div>
            )}
            {guild && (
              <div style={{
                display: "flex", alignItems: "center", gap: "0.55rem",
                padding: "0.55rem 0.7rem", borderRadius: 6,
                background: "var(--accent-50, #16a34a15)",
                border: "1px solid #16a34a40",
              }}>
                {guild.icon && (
                  <img
                    src={`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=64`}
                    alt=""
                    style={{ width: 28, height: 28, borderRadius: 4 }}
                  />
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{guild.name}</div>
                  <div style={{ fontSize: "0.72rem", color: "var(--text-secondary)" }}>
                    {t(
                      "discord.config.guildProbe",
                      "Bot connected · {{m}} members · {{p}} online",
                      {
                        m: guild.approximate_member_count ?? "?",
                        p: guild.approximate_presence_count ?? "?",
                      },
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </Section>

      {/* Auto-promotion whitelists */}
      <Section
        title={t("discord.config.section.whitelists", "Auto-promotion whitelists")}
        ready={
          config.admin_user_ids.length
          + config.operator_user_ids.length
          + config.viewer_user_ids.length > 0
        }
        readyLabel={t("discord.config.ready.whitelists", "Configured")}
        notReadyLabel={t("discord.config.notReady.whitelists", "Empty")}
        icon={<UsersIcon size={14} />}
      >
        <p style={{ fontSize: "0.78rem", color: "var(--text-secondary)", margin: "0 0 0.55rem 0" }}>
          {t(
            "discord.config.whitelistsExplain",
            "Discord IDs listed here are auto-promoted to the matching role at first Sign-in with Discord (a 'discord:<id>' AppUser is created automatically).  The explicit Accounts -> Link AppUser flow always wins over a whitelist.",
          )}
        </p>
        <WhitelistRow
          label={t("discord.config.whitelist.admin", "Admin")}
          ids={config.admin_user_ids}
          envKey="DISCORD_ADMIN_USER_IDS"
        />
        <WhitelistRow
          label={t("discord.config.whitelist.operator", "Operator")}
          ids={config.operator_user_ids}
          envKey="DISCORD_OPERATOR_USER_IDS"
        />
        <WhitelistRow
          label={t("discord.config.whitelist.viewer", "Viewer")}
          ids={config.viewer_user_ids}
          envKey="DISCORD_VIEWER_USER_IDS"
        />
        <div style={{ fontSize: "0.7rem", color: "var(--text-secondary)", marginTop: "0.45rem" }}>
          {t(
            "discord.config.whitelistsEditHint",
            "To change a whitelist: edit /opt/arkmaniagest/backend/.env and run 'systemctl restart arkmaniagest'.",
          )}
        </div>
      </Section>

      {copied && (
        <div className="alert alert-success" style={{ marginTop: 0 }}>
          <CheckCircle size={14} /> {t("discord.config.toast.copied", "Copied to clipboard.")}
        </div>
      )}
    </div>
  );
}

// ── Layout helpers ───────────────────────────────────────────────────────────

function Section({
  title, ready, readyLabel, notReadyLabel, icon, children,
}: {
  title: string;
  ready: boolean;
  readyLabel: string;
  notReadyLabel: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="pl-sync-panel">
      <div className="pl-sync-header">
        <span className="pl-sync-title" style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          {icon} {title}
        </span>
        <span
          className="pl-chip"
          style={{
            background: ready ? "#16a34a15" : "#dc262615",
            color:      ready ? "#16a34a"   : "#dc2626",
            borderColor: ready ? "#16a34a40" : "#dc262640",
          }}
        >
          {ready ? <ShieldCheck size={9} /> : <ShieldAlert size={9} />}
          {ready ? readyLabel : notReadyLabel}
        </span>
      </div>
      <div className="pl-sync-body" style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
        {children}
      </div>
    </div>
  );
}

function KV({
  label, value, hint, onCopy, copied,
}: {
  label: string;
  value: string;
  hint?: string;
  onCopy?: () => void;
  copied?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
        <span style={{
          fontSize: "0.72rem", color: "var(--text-secondary)",
          minWidth: 110, textTransform: "uppercase", letterSpacing: 0.4,
        }}>
          {label}
        </span>
        <span style={{
          fontFamily: "monospace", fontSize: "0.85rem", flex: 1,
          wordBreak: "break-all",
        }}>
          {value}
        </span>
        {onCopy && (
          <button
            onClick={onCopy}
            className="btn btn-secondary btn-sm"
            style={{ padding: "0.15rem 0.35rem" }}
            title="Copy"
          >
            {copied ? <CheckCircle size={11} color="#16a34a" /> : <Copy size={11} />}
          </button>
        )}
      </div>
      {hint && (
        <div style={{ fontSize: "0.7rem", color: "var(--text-secondary)", marginLeft: 110 + 8 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

function MissingHint({ keys }: { keys: string[] }) {
  return (
    <div
      style={{
        marginTop: "0.4rem",
        padding: "0.45rem 0.6rem",
        background: "#dc262610",
        border: "1px solid #dc262640",
        borderRadius: 6,
        fontSize: "0.78rem",
      }}
    >
      <div style={{ fontWeight: 600, color: "#dc2626", marginBottom: "0.2rem" }}>
        Missing .env keys:
      </div>
      <code style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>
        {keys.join(", ")}
      </code>
    </div>
  );
}

function WhitelistRow({
  label, ids, envKey,
}: {
  label: string;
  ids: string[];
  envKey: string;
}) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
        <span style={{
          fontSize: "0.72rem", color: "var(--text-secondary)",
          minWidth: 80, textTransform: "uppercase", letterSpacing: 0.4,
        }}>
          {label}
        </span>
        <span style={{
          fontFamily: "monospace", fontSize: "0.7rem", color: "var(--text-secondary)",
        }}>
          {envKey}
        </span>
        <span style={{ fontSize: "0.72rem", color: "var(--text-secondary)", marginLeft: "auto" }}>
          {ids.length} {ids.length === 1 ? "ID" : "IDs"}
        </span>
      </div>
      <div style={{
        marginTop: "0.25rem",
        display: "flex", flexWrap: "wrap", gap: "0.25rem",
        marginLeft: 80 + 8,
      }}>
        {ids.length === 0
          ? (
            <span style={{ fontSize: "0.78rem", color: "var(--text-secondary)", fontStyle: "italic" }}>
              (empty)
            </span>
          )
          : ids.map(id => (
            <span
              key={id}
              className="pl-chip"
              style={{ fontFamily: "monospace", fontSize: "0.72rem" }}
            >
              {id}
            </span>
          ))}
      </div>
    </div>
  );
}
