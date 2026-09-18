/**
 * DecayCard -- the decay timer, one block per map.
 *
 * A cluster player has a separate tribe -- separate name, separate timer -- on
 * every map they have played, and the single "your tribe expires in 40h" line
 * this card used to show was whichever of them they last logged into. Blocks
 * arrive soonest-deadline-first from the backend, so the base that needs a
 * refresh is the one at the top.
 */
import { useTranslation } from "react-i18next";
import {
  CircleAlert, CircleCheck, Clock, Timer, TriangleAlert, Users, type LucideIcon,
} from "lucide-react";
import { Alert, Badge, Card, EmptyState, type BadgeTone } from "../../../components/ui";
import type { DashboardDecay, DashboardDecayMap } from "../../../services/api";
import { fmtDateTime } from "../../../utils/format";
import { fmtCountdown, fmtRelative } from "../dashboardFormat";
import styles from "../PlayerDashboardPage.module.css";

const STATUS: Record<string, { tone: BadgeTone; icon: LucideIcon; label: string }> = {
  expired:  { tone: "danger",  icon: TriangleAlert, label: "dashboard.decay.statusExpired" },
  expiring: { tone: "warning", icon: CircleAlert,   label: "dashboard.decay.statusExpiring" },
  safe:     { tone: "success", icon: CircleCheck,   label: "dashboard.decay.statusSafe" },
};

export function DecayCard({ data }: { data: DashboardDecay }) {
  const { t } = useTranslation();
  if (!data.has_tribe || data.maps.length === 0) {
    return (
      <Card title={t("dashboard.decay.title")} icon={Timer}>
        <EmptyState icon={Timer} title={t("dashboard.decay.noTribe")} />
      </Card>
    );
  }
  return (
    <Card
      title={data.maps.length > 1
        ? t("dashboard.decay.titleWithCount", { n: data.maps.length })
        : t("dashboard.decay.title")}
      icon={Timer}
    >
      <div className={styles.stack}>
        {data.maps.map(m => <DecayMapBlock key={`${m.server_key}-${m.tribe_id}`} m={m} />)}
      </div>
    </Card>
  );
}

function DecayMapBlock({ m }: { m: DashboardDecayMap }) {
  const { t } = useTranslation();
  const status = (m.status ? STATUS[m.status] : undefined) ?? {
    tone: "neutral" as BadgeTone, icon: Clock, label: "dashboard.decay.statusUnknown",
  };
  const StatusIcon = status.icon;

  return (
    <div className={styles.decayBlock}>
      {/* Map + tribe: which base this timer is about. The tribe name is per
          map, so it belongs here and not in the page header. */}
      <div className={styles.decayHead}>
        <span className={styles.decayMap}>
          {m.map_name || m.server_name || m.server_key || "—"}
        </span>
        <Badge tone={status.tone} icon={StatusIcon}>{t(status.label)}</Badge>
      </div>

      <p className={styles.metaLine}>
        <Users size={16} strokeWidth={1.75} aria-hidden="true" />
        {m.tribe_name || t("dashboard.decay.tribeUnnamed")}
        {m.tribe_id !== null && ` (#${m.tribe_id})`}
      </p>

      {/* The deadline as an actual date: a countdown alone makes the player do
          the arithmetic to find out whether they have to log in before the
          weekend. */}
      <dl className="ui-dl">
        <dt>{t("dashboard.decay.expiresAt")}</dt>
        <dd>
          {m.expire_at
            ? `${fmtDateTime(m.expire_at)} · ${fmtCountdown(m.hours_left, t)}`
            : t("dashboard.decay.noTimer")}
        </dd>
        <dt>{t("dashboard.decay.lastRefreshAt")}</dt>
        <dd>
          {m.last_refresh_at
            ? `${fmtRelative(m.last_refresh_at, t)}${m.last_refresh_name ? ` (${m.last_refresh_name})` : ""}`
            : "—"}
        </dd>
      </dl>

      {m.scheduled_for_purge && (
        <Alert tone="danger">{t("dashboard.decay.scheduledPurge")}</Alert>
      )}
    </div>
  );
}
