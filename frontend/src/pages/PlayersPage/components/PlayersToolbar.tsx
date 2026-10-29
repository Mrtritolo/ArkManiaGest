/**
 * PlayersToolbar — the four KPI tiles and the search / group filter form.
 */
import { useTranslation } from "react-i18next";
import { CreditCard, Search, Shield, Star, Users } from "lucide-react";
import { Button, Input, Select, StatTile } from "../../../components/ui";
import type { PermissionGroupItem, PlayersStats } from "../../../types";

export function PlayersStatsTiles({ stats, failed }: { stats: PlayersStats | null; failed: boolean }) {
  const { t } = useTranslation();
  const loading = stats === null && !failed;
  // Failed before any value arrived: say so instead of a fake 0.
  const missing = stats === null && failed;
  const show = (v: string | number) => (missing ? "—" : v);
  const meta = missing ? t("players.stats.unavailable") : undefined;
  const metaTone = missing ? "danger" as const : undefined;
  return (
    <div className="l-grid--stats">
      <StatTile
        label={t("players.stats.players")}
        icon={Users}
        loading={loading}
        value={show(stats?.total_players ?? 0)}
        meta={meta}
        metaTone={metaTone}
      />
      <StatTile
        label={t("players.stats.pointsInCirculation")}
        icon={Star}
        loading={loading}
        value={show((stats?.total_points_in_circulation ?? 0).toLocaleString(undefined))}
        meta={meta}
        metaTone={metaTone}
      />
      <StatTile
        label={t("players.stats.totalSpent")}
        icon={CreditCard}
        loading={loading}
        value={show((stats?.total_spent ?? 0).toLocaleString(undefined))}
        meta={meta}
        metaTone={metaTone}
      />
      <StatTile
        label={t("players.stats.groups")}
        icon={Shield}
        loading={loading}
        value={show(stats?.permission_groups_count ?? 0)}
        meta={meta}
        metaTone={metaTone}
      />
    </div>
  );
}

export interface PlayersSearchBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  groupFilter: string;
  groups: PermissionGroupItem[];
  onGroupChange: (value: string) => void;
  onSubmit: () => void;
}

export function PlayersSearchBar({
  search,
  onSearchChange,
  groupFilter,
  groups,
  onGroupChange,
  onSubmit,
}: PlayersSearchBarProps) {
  const { t } = useTranslation();
  return (
    <form
      className="l-cluster"
      onSubmit={e => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <Input
        type="search"
        size="sm"
        aria-label={t("players.searchLabel")}
        placeholder={t("players.searchPlaceholder")}
        value={search}
        onChange={e => onSearchChange(e.target.value)}
      />
      <Select
        size="sm"
        aria-label={t("players.groupFilterLabel")}
        value={groupFilter}
        onChange={e => onGroupChange(e.target.value)}
      >
        <option value="">{t("players.allGroups")}</option>
        {groups.map(g => (
          <option key={g.id} value={g.group_name}>
            {g.group_name}
          </option>
        ))}
      </Select>
      <Button type="submit" size="sm" icon={Search}>
        {t("players.searchButton")}
      </Button>
    </form>
  );
}
