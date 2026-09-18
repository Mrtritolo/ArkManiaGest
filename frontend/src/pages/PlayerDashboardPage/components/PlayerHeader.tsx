/**
 * PlayerHeader -- the standalone (Discord-only) hero.
 *
 * Declared at module scope: a component built inside the page's render body is
 * a new type on every render, so React remounted the whole tree on each state
 * change.
 *
 * No brand gradient and no white-on-translucent buttons any more: the header
 * is a plain surface on tokens, so it follows the light and dark themes like
 * the rest of the panel.
 */
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { LogOut, RefreshCw, Server, ShoppingBag, Wifi, WifiOff } from "lucide-react";
import { Avatar, buttonClass, IconButton } from "../../../components/ui";
import DiscordIcon from "../../../components/DiscordIcon";
import type { DashboardDiscord, DashboardPresence, DashboardServerPulse } from "../../../services/api";
import { avatarUrl, fmtMinutes } from "../dashboardFormat";
import styles from "../PlayerDashboardPage.module.css";

export function PlayerHeader({
  discord, characterName, presence, pulse, refreshing, onRefresh, onLogout,
}: {
  discord: DashboardDiscord | null;
  characterName: string | null;
  presence: DashboardPresence | null;
  pulse: DashboardServerPulse | null;
  refreshing: boolean;
  onRefresh: () => void;
  onLogout: () => void;
}) {
  const { t } = useTranslation();
  const av = discord ? avatarUrl(discord.discord_user_id, discord.discord_avatar) : null;
  const name = characterName
    || discord?.discord_global_name
    || discord?.discord_username
    || t("dashboard.player");

  return (
    <header className={styles.playerHeader}>
      <div className={styles.identity}>
        <Avatar name={name} src={av} size="lg" />
        <div className={styles.identityText}>
          <h1 className={styles.greeting}>{t("dashboard.greeting", { n: name })}</h1>
          <div className={styles.meta}>
            <span className={styles.metaItem}>
              <DiscordIcon size={16} />
              {discord?.discord_username ? `@${discord.discord_username}` : (discord?.discord_user_id ?? "")}
            </span>
            {presence?.online_now ? (
              <span className={styles.metaItem}>
                <Wifi size={16} strokeWidth={1.75} aria-hidden="true" />
                {t("dashboard.header.onlineOn", {
                  s: presence.server_name || presence.server_key || "?",
                  m: fmtMinutes(presence.duration_minutes),
                })}
              </span>
            ) : (
              <span className={styles.metaItem}>
                <WifiOff size={16} strokeWidth={1.75} aria-hidden="true" />
                {t("dashboard.header.offline")}
              </span>
            )}
            {pulse && (
              <span className={styles.metaItem}>
                <Server size={16} strokeWidth={1.75} aria-hidden="true" />
                {t("dashboard.header.pulse", {
                  p: pulse.players_online_total,
                  s: pulse.servers_online,
                  t: pulse.servers_total,
                })}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="l-cluster">
        {/* The market was reachable only by typing the URL: a Discord player
            never renders the sidebar that links to it. */}
        <Link to="/market" className={buttonClass({ variant: "secondary" })}>
          <ShoppingBag aria-hidden="true" />
          {t("nav.market")}
        </Link>
        <IconButton icon={RefreshCw} label={t("common.refresh")}
          loading={refreshing} onClick={onRefresh} />
        <IconButton icon={LogOut} label={t("nav.logout")} onClick={onLogout} />
      </div>
    </header>
  );
}
