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
  Star, ArrowDownUp,
} from "lucide-react";
import {
  discordApi,
  type DiscordConfigStatus, type DiscordGuildInfo,
  type VipSyncReport,
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
            t("discord.config.errors.guildProbe"),
          ));
        }
      }
    } catch (err: unknown) {
      setError(extractError(err, t("discord.config.errors.load")));
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="pl-loading">
        <Loader2 size={20} className="pl-spin" />{" "}
        {t("discord.config.loading")}
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
          <RefreshCw size={12} /> {t("common.refresh")}
        </button>
      </div>

      {/* OAuth readiness */}
      <Section
        title={t("discord.config.section.oauth")}
        ready={config.oauth_ready}
        readyLabel={t("discord.config.ready.oauth")}
        notReadyLabel={t("discord.config.notReady.oauth")}
        icon={<KeyRound size={14} />}
      >
        <KV label={t("discord.config.field.clientId")}
            value={config.client_id || "—"}
            onCopy={config.client_id ? () => { copy(config.client_id); setCopied("client_id"); } : undefined}
            copied={copied === "client_id"}
        />
        <KV label={t("discord.config.field.publicKey")}
            value={config.public_key ? config.public_key.slice(0, 16) + "…" : "—"}
        />
        <KV label={t("discord.config.field.redirectUri")}
            value={config.redirect_uri || "—"}
            hint={!config.redirect_uri
              ? t("discord.config.hint.redirectMissing")
              : t("discord.config.hint.redirectRegister")
            }
            onCopy={config.redirect_uri
              ? () => { copy(config.redirect_uri); setCopied("redirect_uri"); }
              : undefined}
            copied={copied === "redirect_uri"}
        />
        <KV label={t("discord.config.field.clientSecret")}
            value={config.has_client_secret
              ? t("discord.config.placeholder.set")
              : t("discord.config.placeholder.notSet")}
        />
        {config.missing_for_oauth.length > 0 && (
          <MissingHint keys={config.missing_for_oauth} />
        )}
      </Section>

      {/* Bot readiness */}
      <Section
        title={t("discord.config.section.bot")}
        ready={config.bot_ready}
        readyLabel={t("discord.config.ready.bot")}
        notReadyLabel={t("discord.config.notReady.bot")}
        icon={<Bot size={14} />}
      >
        <KV label={t("discord.config.field.guildId")}
            value={config.guild_id || "—"}
            onCopy={config.guild_id ? () => { copy(config.guild_id); setCopied("guild_id"); } : undefined}
            copied={copied === "guild_id"}
        />
        <KV label={t("discord.config.field.botToken")}
            value={config.has_bot_token
              ? t("discord.config.placeholder.set")
              : t("discord.config.placeholder.notSet")}
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

      {/* VIP sync (Phase 4) */}
      <VipSyncSection config={config} />

      {/* Auto-promotion whitelists */}
      <Section
        title={t("discord.config.section.whitelists")}
        ready={
          config.admin_user_ids.length
          + config.operator_user_ids.length
          + config.viewer_user_ids.length > 0
        }
        readyLabel={t("discord.config.ready.whitelists")}
        notReadyLabel={t("discord.config.notReady.whitelists")}
        icon={<UsersIcon size={14} />}
      >
        <p style={{ fontSize: "0.78rem", color: "var(--text-secondary)", margin: "0 0 0.55rem 0" }}>
          {t("discord.config.whitelistsExplain")}
        </p>
        <WhitelistRow
          label={t("discord.config.whitelist.admin")}
          ids={config.admin_user_ids}
          envKey="DISCORD_ADMIN_USER_IDS"
        />
        <WhitelistRow
          label={t("discord.config.whitelist.operator")}
          ids={config.operator_user_ids}
          envKey="DISCORD_OPERATOR_USER_IDS"
        />
        <WhitelistRow
          label={t("discord.config.whitelist.viewer")}
          ids={config.viewer_user_ids}
          envKey="DISCORD_VIEWER_USER_IDS"
        />
        <div style={{ fontSize: "0.7rem", color: "var(--text-secondary)", marginTop: "0.45rem" }}>
          {t("discord.config.whitelistsEditHint")}
        </div>
      </Section>

      {copied && (
        <div className="alert alert-success" style={{ marginTop: 0 }}>
          <CheckCircle size={14} /> {t("discord.config.toast.copied")}
        </div>
      )}
    </div>
  );
}

// ── VIP sync section ─────────────────────────────────────────────────────────

function VipSyncSection({ config }: { config: DiscordConfigStatus }) {
  const { t } = useTranslation();
  const [running, setRunning] = useState(false);
  const [report,  setReport]  = useState<VipSyncReport | null>(null);
  const [error,   setError]   = useState("");
  const [showAll, setShowAll] = useState(false);

  async function runSync(): Promise<void> {
    setRunning(true);
    setError("");
    try {
      const res = await discordApi.syncVip();
      setReport(res.data);
    } catch (err: unknown) {
      setError(extractError(err, t("discord.config.vipSync.errors.run")));
    } finally {
      setRunning(false);
    }
  }

  return (
    <Section
      title={t("discord.config.section.vipSync")}
      ready={config.vip_sync_ready}
      readyLabel={t("discord.config.ready.vipSync")}
      notReadyLabel={t("discord.config.notReady.vipSync")}
      icon={<Star size={14} />}
    >
      <p style={{ fontSize: "0.78rem", color: "var(--text-secondary)", margin: "0 0 0.55rem 0" }}>
        {t("discord.config.vipSync.explain")}
      </p>
      <KV
        label={t("discord.config.field.vipRoleId")}
        value={config.vip_role_id || "—"}
        hint={!config.vip_role_id
          ? t("discord.config.hint.vipRoleMissing")
          : undefined}
      />

      {error && (
        <div className="alert alert-error" style={{ marginTop: "0.5rem" }}>
          <AlertCircle size={14} /> {error}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.6rem" }}>
        <button
          onClick={runSync}
          disabled={running || !config.vip_sync_ready}
          className="btn btn-primary btn-sm"
        >
          {running
            ? <Loader2 size={12} className="pl-spin" />
            : <ArrowDownUp size={12} />}
          {" "}
          {running
            ? t("discord.config.vipSync.running")
            : t("discord.config.vipSync.run")}
        </button>
        {report && (
          <span style={{ fontSize: "0.72rem", color: "var(--text-secondary)" }}>
            {t(
              "discord.config.vipSync.lastRun",
              {
                d: new Date(report.finished_at_iso).toLocaleString(),
                s: report.duration_seconds.toFixed(1),
                n: report.linked_total,
              },
            )}
          </span>
        )}
      </div>

      {report && (
        <div style={{
          marginTop: "0.5rem",
          padding: "0.55rem 0.7rem",
          background: "var(--bg-card-muted, #f5f5f7)",
          borderRadius: 6,
          fontSize: "0.8rem",
          display: "flex", flexDirection: "column", gap: "0.3rem",
        }}>
          <div style={{ display: "flex", gap: "0.8rem", flexWrap: "wrap" }}>
            <Metric value={report.assigned_count} label="assegnati" color="#16a34a" />
            <Metric value={report.removed_count}  label="rimossi"   color="#d97706" />
            <Metric value={report.noop_count}     label="no-op"     color="#6b7280" />
            <Metric value={report.error_count}    label="errori"    color={report.error_count > 0 ? "#dc2626" : "#6b7280"} />
            <Metric value={report.unmapped_with_vip.length} label="stranger VIP" color="#6b7280" />
          </div>

          {report.unmapped_with_vip.length > 0 && (
            <details style={{ fontSize: "0.75rem" }}>
              <summary style={{ cursor: "pointer", color: "var(--text-secondary)" }}>
                {t(
                  "discord.config.vipSync.strangerVips",
                  {
                    n: report.unmapped_with_vip.length,
                  },
                )}
              </summary>
              <div style={{
                marginTop: "0.3rem", display: "flex", flexWrap: "wrap", gap: "0.25rem",
              }}>
                {report.unmapped_with_vip.map(id => (
                  <span key={id} className="pl-chip" style={{ fontFamily: "monospace", fontSize: "0.7rem" }}>
                    {id}
                  </span>
                ))}
              </div>
            </details>
          )}

          {report.actions.length > 0 && (
            <details style={{ fontSize: "0.75rem" }}>
              <summary
                style={{ cursor: "pointer", color: "var(--text-secondary)" }}
                onClick={() => setShowAll(true)}
              >
                {t(
                  "discord.config.vipSync.perRow",
                  {
                    n: report.actions.length,
                  },
                )}
              </summary>
              <div style={{ marginTop: "0.3rem", maxHeight: 240, overflowY: "auto" }}>
                <table className="pl-table" style={{ fontSize: "0.72rem" }}>
                  <thead>
                    <tr>
                      <th>{t("discord.config.vipSync.col.player")}</th>
                      <th>{t("discord.config.vipSync.col.discord")}</th>
                      <th>{t("discord.config.vipSync.col.action")}</th>
                      <th>{t("discord.config.vipSync.col.detail")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(showAll ? report.actions : report.actions.slice(0, 50)).map((a, i) => (
                      <tr key={`${a.discord_user_id}-${i}`}>
                        <td>{a.player_name || a.eos_id.slice(0, 8) + "…"}</td>
                        <td style={{ fontFamily: "monospace", fontSize: "0.68rem" }}>
                          {a.discord_user_id}
                        </td>
                        <td>
                          <span
                            className="pl-chip"
                            style={{
                              background: actionBg(a.action),
                              color:      actionColor(a.action),
                              borderColor: actionBorder(a.action),
                            }}
                          >
                            {a.action}
                          </span>
                        </td>
                        <td style={{ color: "var(--text-secondary)" }}>{a.detail || ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!showAll && report.actions.length > 50 && (
                  <div style={{ textAlign: "center", marginTop: "0.3rem" }}>
                    <button onClick={() => setShowAll(true)} className="btn btn-secondary btn-sm">
                      {t("common.showAll")}
                      {" "}({report.actions.length})
                    </button>
                  </div>
                )}
              </div>
            </details>
          )}
        </div>
      )}
    </Section>
  );
}

function Metric({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 64 }}>
      <div style={{ fontSize: "1.1rem", fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: "0.65rem", color: "var(--text-secondary)", textTransform: "uppercase" }}>
        {label}
      </div>
    </div>
  );
}

function actionBg(a: string): string {
  if (a === "assigned") return "#16a34a15";
  if (a === "removed")  return "#d9770615";
  if (a === "error")    return "#dc262615";
  return "#6b728015";
}
function actionColor(a: string): string {
  if (a === "assigned") return "#16a34a";
  if (a === "removed")  return "#d97706";
  if (a === "error")    return "#dc2626";
  return "#6b7280";
}
function actionBorder(a: string): string {
  if (a === "assigned") return "#16a34a40";
  if (a === "removed")  return "#d9770640";
  if (a === "error")    return "#dc262640";
  return "#6b728040";
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
