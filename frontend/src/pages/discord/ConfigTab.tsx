/**
 * ConfigTab.tsx — Settings -> Discord -> Configuration.
 *
 * Diagnostic-only view of the Discord integration's environment-driven
 * configuration:
 *
 *   1. OAuth readiness   -- public Client ID + redirect URI + which .env
 *                           keys are still empty.
 *   2. Bot readiness     -- public guild ID + which .env keys are still
 *                           empty.  When populated, also the bot's view of
 *                           the guild (name + member count).
 *   3. VIP sync          -- the configured role plus the manual run and its
 *                           last report.
 *   4. Auto-promotion whitelists -- the three CSV lists of Discord IDs that
 *                           get an AppUser auto-created at admin/operator/
 *                           viewer role on first Discord login.
 *
 * Editing happens on the Edit tab (and takes a service restart); everything
 * here is read-only apart from the VIP sync trigger.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDownUp,
  Bot,
  KeyRound,
  RotateCw,
  ShieldAlert,
  ShieldCheck,
  Star,
  Users as UsersIcon,
  type LucideIcon,
} from "lucide-react";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CopyButton,
  NotAvailable,
  Spinner,
  StatTile,
  Table,
  useConfirm,
} from "../../components/ui";
import {
  discordApi,
  type DiscordConfigStatus,
  type DiscordGuildInfo,
  type VipSyncReport,
} from "../../services/api";
import { extractError } from "../../utils/errors";
import { fmtLocaleDateTime } from "../../utils/format";
import styles from "./DiscordTabs.module.css";

const ACTIONS_PREVIEW = 50;

export default function ConfigTab() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<DiscordConfigStatus | null>(null);
  const [guild, setGuild] = useState<DiscordGuildInfo | null>(null);
  const [guildErr, setGuildErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadAll(): Promise<void> {
    setLoading(true);
    setError("");
    setGuildErr("");
    setGuild(null);
    try {
      const cfg = await discordApi.config();
      setConfig(cfg.data);
      // Only attempt the guild probe when bot creds look complete --
      // otherwise we'd 409 on every render.
      if (cfg.data.bot_ready) {
        try {
          const g = await discordApi.guildInfo();
          setGuild(g.data);
        } catch (err: unknown) {
          setGuildErr(extractError(err, t("discord.config.errors.guildProbe")));
        }
      }
    } catch (err: unknown) {
      setError(extractError(err, t("discord.config.errors.load")));
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <Spinner block label={t("discord.config.loading")} />;
  }

  if (error || !config) {
    return (
      <Alert
        tone="danger"
        title={t("discord.config.errors.load")}
        actions={
          <Button size="sm" icon={RotateCw} onClick={() => void loadAll()}>
            {t("common.retry")}
          </Button>
        }
      >
        {error || t("common.pageLoadError")}
      </Alert>
    );
  }

  const whitelistTotal =
    config.admin_user_ids.length + config.operator_user_ids.length + config.viewer_user_ids.length;

  return (
    <div className="l-stack">
      <div className="l-cluster l-cluster--end">
        <Button size="sm" icon={RotateCw} onClick={() => void loadAll()}>
          {t("common.refresh")}
        </Button>
      </div>

      {/* OAuth readiness */}
      <Section
        title={t("discord.config.section.oauth")}
        icon={KeyRound}
        ready={config.oauth_ready}
        readyLabel={t("discord.config.ready.oauth")}
        notReadyLabel={t("discord.config.notReady.oauth")}
      >
        <dl className="ui-dl">
          <KV label={t("discord.config.field.clientId")} value={config.client_id} copyable />
          <KV
            label={t("discord.config.field.publicKey")}
            value={config.public_key ? `${config.public_key.slice(0, 16)}…` : ""}
          />
          <KV
            label={t("discord.config.field.redirectUri")}
            value={config.redirect_uri}
            copyable
            hint={
              config.redirect_uri
                ? t("discord.config.hint.redirectRegister")
                : t("discord.config.hint.redirectMissing")
            }
          />
          <KV
            label={t("discord.config.field.clientSecret")}
            value={
              config.has_client_secret
                ? t("discord.config.placeholder.set")
                : t("discord.config.placeholder.notSet")
            }
          />
        </dl>
        <MissingKeys keys={config.missing_for_oauth} />
      </Section>

      {/* Bot readiness */}
      <Section
        title={t("discord.config.section.bot")}
        icon={Bot}
        ready={config.bot_ready}
        readyLabel={t("discord.config.ready.bot")}
        notReadyLabel={t("discord.config.notReady.bot")}
      >
        <dl className="ui-dl">
          <KV label={t("discord.config.field.guildId")} value={config.guild_id} copyable />
          <KV
            label={t("discord.config.field.botToken")}
            value={
              config.has_bot_token
                ? t("discord.config.placeholder.set")
                : t("discord.config.placeholder.notSet")
            }
          />
        </dl>
        <MissingKeys keys={config.missing_for_bot} />

        {/* Live guild probe */}
        {config.bot_ready && guildErr && <Alert tone="danger">{guildErr}</Alert>}
        {config.bot_ready && guild && (
          <div className={styles.guildRow}>
            <Avatar
              name={guild.name}
              src={
                guild.icon
                  ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=64`
                  : null
              }
              size="sm"
            />
            <span>{guild.name}</span>
            <span className="u-secondary u-text-sm">
              {t("discord.config.guildProbe", {
                m: guild.approximate_member_count ?? "?",
                p: guild.approximate_presence_count ?? "?",
              })}
            </span>
          </div>
        )}
      </Section>

      {/* VIP sync (Phase 4) */}
      <VipSyncSection config={config} />

      {/* Auto-promotion whitelists */}
      <Section
        title={t("discord.config.section.whitelists")}
        icon={UsersIcon}
        ready={whitelistTotal > 0}
        readyLabel={t("discord.config.ready.whitelists")}
        notReadyLabel={t("discord.config.notReady.whitelists")}
      >
        <p className="u-secondary u-text-sm">{t("discord.config.whitelistsExplain")}</p>
        <dl className="ui-dl">
          <WhitelistRow
            label={t("discord.config.whitelist.admin")}
            envKey="DISCORD_ADMIN_USER_IDS"
            ids={config.admin_user_ids}
          />
          <WhitelistRow
            label={t("discord.config.whitelist.operator")}
            envKey="DISCORD_OPERATOR_USER_IDS"
            ids={config.operator_user_ids}
          />
          <WhitelistRow
            label={t("discord.config.whitelist.viewer")}
            envKey="DISCORD_VIEWER_USER_IDS"
            ids={config.viewer_user_ids}
          />
        </dl>
        <p className="u-muted u-text-sm">{t("discord.config.whitelistsEditHint")}</p>
      </Section>
    </div>
  );
}

// ── VIP sync section ─────────────────────────────────────────────────────────

function VipSyncSection({ config }: { config: DiscordConfigStatus }) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<VipSyncReport | null>(null);
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);

  async function runSync(): Promise<void> {
    const ok = await confirm({
      title: t("discord.config.vipSync.confirmTitle"),
      description: t("discord.config.vipSync.confirmBody"),
      confirmLabel: t("discord.config.vipSync.run"),
    });
    if (!ok) return;
    setRunning(true);
    setError("");
    setShowAll(false);
    try {
      const res = await discordApi.syncVip();
      setReport(res.data);
    } catch (err: unknown) {
      setError(extractError(err, t("discord.config.vipSync.errors.run")));
    } finally {
      setRunning(false);
    }
  }

  const actions = report
    ? showAll
      ? report.actions
      : report.actions.slice(0, ACTIONS_PREVIEW)
    : [];
  // The stranger list is built from a guild member walk: when that walk
  // failed or stopped at its page cap the list is a sample, not the truth.
  const scanIncomplete = report !== null && !report.member_scan_complete;

  return (
    <Section
      title={t("discord.config.section.vipSync")}
      icon={Star}
      ready={config.vip_sync_ready}
      readyLabel={t("discord.config.ready.vipSync")}
      notReadyLabel={t("discord.config.notReady.vipSync")}
      action={
        <Button
          size="sm"
          icon={ArrowDownUp}
          loading={running}
          loadingLabel={t("discord.config.vipSync.running")}
          disabled={!config.vip_sync_ready}
          title={config.vip_sync_ready ? undefined : t("discord.config.notReady.vipSync")}
          onClick={() => void runSync()}
        >
          {t("discord.config.vipSync.run")}
        </Button>
      }
    >
      <p className="u-secondary u-text-sm">{t("discord.config.vipSync.explain")}</p>
      <dl className="ui-dl">
        <KV
          label={t("discord.config.field.vipRoleId")}
          value={config.vip_role_id}
          hint={config.vip_role_id ? undefined : t("discord.config.hint.vipRoleMissing")}
        />
      </dl>

      {error && <Alert tone="danger">{error}</Alert>}

      {report && (
        <>
          <p className="u-secondary u-text-sm">
            {t("discord.config.vipSync.lastRun", {
              d: fmtLocaleDateTime(report.finished_at_iso),
              s: report.duration_seconds.toFixed(1),
              n: report.linked_total,
            })}
          </p>

          <div className="l-grid--stats">
            <StatTile
              label={t("discord.config.vipSync.metric.assigned")}
              value={report.assigned_count}
            />
            <StatTile label={t("discord.config.vipSync.metric.removed")} value={report.removed_count} />
            <StatTile label={t("discord.config.vipSync.metric.noop")} value={report.noop_count} />
            <StatTile
              label={t("discord.config.vipSync.metric.errors")}
              value={report.error_count}
              meta={report.error_count > 0 ? t("discord.config.vipSync.hasErrors") : undefined}
              metaTone={report.error_count > 0 ? "danger" : undefined}
            />
            <StatTile
              label={t("discord.config.vipSync.metric.strangers")}
              value={report.unmapped_with_vip.length}
              meta={scanIncomplete ? t("discord.config.vipSync.partial") : undefined}
              metaTone={scanIncomplete ? "warning" : undefined}
            />
          </div>

          {scanIncomplete && (
            <Alert tone="warning">
              {report.member_scan_error
                ? t("discord.config.vipSync.scanFailed", { error: report.member_scan_error })
                : t("discord.config.vipSync.scanCapped")}
            </Alert>
          )}

          {report.unmapped_with_vip.length > 0 && (
            <details className="ui-details">
              <summary>
                {t("discord.config.vipSync.strangerVips", { n: report.unmapped_with_vip.length })}
              </summary>
              <div className={`ui-details__body ${styles.idList}`}>
                {report.unmapped_with_vip.map((id) => (
                  <Badge key={id}>
                    <span className="u-mono">{id}</span>
                  </Badge>
                ))}
              </div>
            </details>
          )}

          {report.actions.length > 0 && (
            <details className="ui-details">
              <summary>{t("discord.config.vipSync.perRow", { n: report.actions.length })}</summary>
              <div className="ui-details__body">
                <Table label={t("discord.config.vipSync.perRow", { n: report.actions.length })} maxHeight="30vh" minWidth={640}>
                  <thead>
                    <tr>
                      <th scope="col">{t("discord.config.vipSync.col.player")}</th>
                      <th scope="col">{t("discord.config.vipSync.col.discord")}</th>
                      <th scope="col">{t("discord.config.vipSync.col.action")}</th>
                      <th scope="col">{t("discord.config.vipSync.col.detail")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {actions.map((a, i) => (
                      <tr key={`${a.discord_user_id}-${i}`}>
                        <td>
                          {a.player_name || t("discord.common.eosShort", { id: a.eos_id.slice(0, 8) })}
                        </td>
                        <td className="u-mono">{a.discord_user_id}</td>
                        <td>
                          <Badge tone={a.action === "error" ? "danger" : "neutral"}>
                            {t(`discord.config.vipSync.action.${a.action}`)}
                          </Badge>
                        </td>
                        <td className="ui-cell-wrap u-secondary">{a.detail || ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                {!showAll && report.actions.length > ACTIONS_PREVIEW && (
                  <div className="l-cluster">
                    <Button size="sm" onClick={() => setShowAll(true)}>
                      {t("common.showAll")} ({report.actions.length})
                    </Button>
                  </div>
                )}
              </div>
            </details>
          )}
        </>
      )}
    </Section>
  );
}

// ── Layout helpers ───────────────────────────────────────────────────────────

function Section({
  title,
  icon,
  ready,
  readyLabel,
  notReadyLabel,
  action,
  children,
}: {
  title: string;
  icon: LucideIcon;
  ready: boolean;
  readyLabel: string;
  notReadyLabel: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card
      title={title}
      icon={icon}
      actions={
        <>
          <Badge tone={ready ? "success" : "danger"} icon={ready ? ShieldCheck : ShieldAlert}>
            {ready ? readyLabel : notReadyLabel}
          </Badge>
          {action}
        </>
      }
    >
      <div className="l-stack">{children}</div>
    </Card>
  );
}

/** One label/value pair of a `dl.ui-dl`, with an optional copy action. */
function KV({
  label,
  value,
  hint,
  copyable,
}: {
  label: string;
  value: string;
  hint?: string;
  copyable?: boolean;
}) {
  const { t } = useTranslation();
  const empty = value === "";
  return (
    <>
      <dt>{label}</dt>
      <dd>
        <span className={styles.kvValue}>
          {/* The kit's "--" + screen-reader "not available"; the whitelist's
              own "(empty)" is written for a list and does not fit here. */}
          {empty ? <NotAvailable /> : <span className="u-mono">{value}</span>}
          {copyable && !empty && (
            <CopyButton value={value} label={`${t("discord.config.copy")}: ${label}`} />
          )}
        </span>
        {hint && <span className="u-muted u-text-sm">{hint}</span>}
      </dd>
    </>
  );
}

function MissingKeys({ keys }: { keys: string[] }) {
  const { t } = useTranslation();
  if (keys.length === 0) return null;
  return (
    <Alert tone="danger" title={t("discord.config.missingKeys")}>
      <code className="ui-code">{keys.join(", ")}</code>
    </Alert>
  );
}

function WhitelistRow({ label, envKey, ids }: { label: string; envKey: string; ids: string[] }) {
  const { t } = useTranslation();
  return (
    <>
      <dt>
        <span className={styles.kvValue}>
          <span>{label}</span>
          <code className="ui-code">{envKey}</code>
        </span>
      </dt>
      <dd>
        <div className={styles.idList}>
          {ids.length === 0 ? (
            <span className="u-muted">{t("discord.config.whitelist.empty")}</span>
          ) : (
            <>
              {ids.map((id) => (
                <Badge key={id}>
                  <span className="u-mono">{id}</span>
                </Badge>
              ))}
              <span className="u-muted u-text-sm">
                {t("discord.config.whitelist.idCount", { count: ids.length })}
              </span>
            </>
          )}
        </div>
      </dd>
    </>
  );
}
