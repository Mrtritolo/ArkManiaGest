/**
 * FeedCards -- the three list cards: the tribe roster, the rare-dino events of
 * the last 30 days, and the recent activity feed.
 *
 * Each list scrolls inside its own focusable region, so the overflow is
 * reachable with a keyboard and never stretches the card grid.
 */
import { useTranslation } from "react-i18next";
import { Activity as ActivityIcon, Skull, Users } from "lucide-react";
import { Badge, Card, EmptyState, StatTile } from "../../../components/ui";
import type {
  DashboardActivity, DashboardRareDinos, DashboardTribe,
} from "../../../services/api";
import { fmtRelative } from "../dashboardFormat";
import styles from "../PlayerDashboardPage.module.css";

export function TribeCard({ data }: { data: DashboardTribe }) {
  const { t } = useTranslation();
  if (!data.has_tribe) {
    return (
      <Card title={t("dashboard.tribe.title")} icon={Users}>
        <EmptyState icon={Users} title={t("dashboard.tribe.empty")} />
      </Card>
    );
  }
  const onlineCount = data.members.filter(m => m.online_now).length;
  const title = t("dashboard.tribe.titleWithCount", {
    n: data.tribe_name || `#${data.tribe_id ?? "?"}`,
    m: data.members.length,
    o: onlineCount,
  });
  return (
    <Card title={title} icon={Users}>
      <div className={styles.list} tabIndex={0} role="group" aria-label={title}>
        {data.members.map(m => (
          <div key={m.eos_id} className={m.is_self ? `${styles.row} ${styles.rowSelf}` : styles.row}>
            <span className={`${styles.rowMain} u-truncate`}>
              {m.name || m.eos_id.slice(0, 8) + "…"}
              {m.is_self && <span className="u-secondary"> {t("dashboard.tribe.self")}</span>}
            </span>
            <span className={styles.rowMeta}>
              {m.online_now
                ? <Badge tone="success" dot>{t("dashboard.tribe.onlineNow")}</Badge>
                : fmtRelative(m.last_login_iso, t)}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function RareDinosCard({ data }: { data: DashboardRareDinos }) {
  const { t } = useTranslation();
  return (
    <Card title={t("dashboard.rare.title")} icon={Skull}>
      <div className={styles.stack}>
        <div className={styles.tileRow}>
          <StatTile label={t("dashboard.rare.kills")} value={data.kills_30d} />
          <StatTile label={t("dashboard.rare.tames")} value={data.tames_30d} />
        </div>
        {data.recent.length === 0 ? (
          <EmptyState icon={Skull} title={t("dashboard.rare.empty")} />
        ) : (
          <div className={styles.list} tabIndex={0} role="group"
               aria-label={t("dashboard.rare.recentLabel")}>
            {data.recent.map(e => (
              <div key={e.id} className={styles.row}>
                <span className={`${styles.rowMain} l-cluster`}>
                  <Badge tone={e.event_type === "KILLED" ? "danger" : "success"} dot>
                    {t(`dashboard.rare.event.${e.event_type}`, { defaultValue: e.event_type })}
                  </Badge>
                  <span>
                    {e.dino_name || t("dashboard.rare.unknownDino")}
                    {e.dino_level !== null
                      ? ` ${t("dashboard.rare.level", { n: e.dino_level })}`
                      : ""}
                  </span>
                </span>
                <span className={styles.rowMeta}>{fmtRelative(e.event_at_iso, t)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

export function ActivityCard({ data }: { data: DashboardActivity }) {
  const { t } = useTranslation();
  if (data.items.length === 0) {
    return (
      <Card title={t("dashboard.activity.title")} icon={ActivityIcon}>
        <EmptyState icon={ActivityIcon} title={t("dashboard.activity.empty")} />
      </Card>
    );
  }
  return (
    <Card title={t("dashboard.activity.title")} icon={ActivityIcon}>
      <div className={`${styles.list} ${styles.listTall}`} tabIndex={0} role="group"
           aria-label={t("dashboard.activity.title")}>
        {data.items.map((e, i) => (
          <div key={i} className={styles.row}>
            <span className={`${styles.rowMain} l-cluster`}>
              <Badge tone={e.source === "lb_event" ? "accent" : "neutral"}>
                {t(`dashboard.activity.kind.${e.kind}`, { defaultValue: e.kind })}
              </Badge>
              {e.points !== null && (
                <strong className="u-num">{t("dashboard.activity.points", { n: e.points })}</strong>
              )}
              {e.detail && <span className="u-secondary">{e.detail}</span>}
            </span>
            <span className={styles.rowMeta}>{fmtRelative(e.when_iso, t)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
