/**
 * ScoreCards -- what the player has earned: ArkShop points and the
 * leaderboard standing, with the percentile as a bar rather than a colour.
 */
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import {
  Bone, Coins, Crosshair, Hammer, Home, PawPrint, Skull, Swords, Trophy,
  type LucideIcon,
} from "lucide-react";
import { Card, EmptyState, Meter, StatTile } from "../../../components/ui";
import type {
  DashboardLeaderboard, DashboardLeaderboardScoreRow, DashboardShop,
} from "../../../services/api";
import styles from "../PlayerDashboardPage.module.css";

export function ShopCard({ data }: { data: DashboardShop }) {
  const { t } = useTranslation();
  return (
    <Card title={t("dashboard.shop.title")} icon={Coins}>
      <div className={styles.stack}>
        <div className={styles.tileRow}>
          <StatTile label={t("dashboard.shop.points")} value={data.points.toLocaleString()} />
          <StatTile label={t("dashboard.shop.totalSpent")} value={data.total_spent.toLocaleString()} />
        </div>
        {data.kits_raw && (
          <details className="ui-details">
            <summary>{t("dashboard.shop.kitsRawToggle")}</summary>
            <div className="ui-details__body">
              <pre className="ui-code">{data.kits_raw}</pre>
            </div>
          </details>
        )}
      </div>
    </Card>
  );
}

export function LeaderboardCard({ data }: { data: DashboardLeaderboard }) {
  const { t } = useTranslation();
  if (!data.has_scores) {
    return (
      <Card title={t("dashboard.leaderboard.title")} icon={Trophy}>
        <EmptyState icon={Trophy} title={t("dashboard.leaderboard.empty")} />
      </Card>
    );
  }
  return (
    <Card title={t("dashboard.leaderboard.title")} icon={Trophy}>
      <div className={styles.stack}>
        {data.scores.map((s, i) => <LeaderboardScoreBlock key={i} score={s} />)}
      </div>
    </Card>
  );
}

type ScoreKey = "kills_wild" | "tames" | "kills_player" | "crafts"
  | "kills_enemy_dino" | "structs_destroyed" | "deaths";

const SCORE_ROWS: ReadonlyArray<{ key: ScoreKey; label: string; icon: LucideIcon }> = [
  { key: "kills_wild", label: "dashboard.lb.killWild", icon: Swords },
  { key: "tames", label: "dashboard.lb.tames", icon: PawPrint },
  { key: "kills_player", label: "dashboard.lb.killPlayer", icon: Crosshair },
  { key: "crafts", label: "dashboard.lb.crafts", icon: Hammer },
  { key: "kills_enemy_dino", label: "dashboard.lb.killDino", icon: Bone },
  { key: "structs_destroyed", label: "dashboard.lb.structs", icon: Home },
  { key: "deaths", label: "dashboard.lb.deaths", icon: Skull },
];

function LeaderboardScoreBlock({ score }: { score: DashboardLeaderboardScoreRow }) {
  const { t } = useTranslation();
  // Two readings of the same rank. `fill` is how far up the ladder the player
  // stands (rank 1 fills the bar), `top` is the share of players at or above
  // this rank -- the number "Top n%" actually means, so rank 1 of 500 reads
  // "Top 1%", not "Top 100%".
  const pct = (score.rank && score.total_players)
    ? {
        fill: 100 - ((score.rank - 1) / score.total_players) * 100,
        top: Math.max(1, Math.round((score.rank / score.total_players) * 100)),
      }
    : null;
  const tone = pct === null ? "accent" : pct.fill > 75 ? "success" : pct.fill > 25 ? "warning" : "danger";

  return (
    <div className={styles.stack}>
      <div className="l-cluster l-cluster--between">
        <span className={styles.decayMap}>
          {score.server_type
            ? t("dashboard.leaderboard.rankLine", {
                rank: score.rank, total: score.total_players, type: score.server_type,
              })
            : "—"}
        </span>
        <span className="u-secondary u-num">
          {t("dashboard.leaderboard.points", { n: score.total_points.toLocaleString() })}
        </span>
      </div>
      {pct !== null && (
        <div className="l-cluster">
          <Meter
            value={pct.fill}
            tone={tone}
            label={t("dashboard.leaderboard.percentileLabel")}
            valueText={t("dashboard.leaderboard.percentile", { n: pct.top })}
            className={styles.rowMain}
          />
          <span className="u-secondary u-text-sm u-num">
            {t("dashboard.leaderboard.percentile", { n: pct.top })}
          </span>
        </div>
      )}
      <dl className={styles.statList}>
        {SCORE_ROWS.map(row => {
          const Icon = row.icon;
          return (
            <Fragment key={row.key}>
              <dt>
                <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
                {t(row.label)}
              </dt>
              <dd>{score[row.key].toLocaleString()}</dd>
            </Fragment>
          );
        })}
      </dl>
    </div>
  );
}
