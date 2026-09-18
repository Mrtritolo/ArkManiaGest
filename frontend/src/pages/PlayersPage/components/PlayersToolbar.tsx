/**
 * PlayersToolbar — the four KPI tiles and the search / group filter form.
 */
import { useTranslation } from "react-i18next";
import { CreditCard, Search, Shield, Star, Users } from "lucide-react";
import { Button, Input, Select, StatTile } from "../../../components/ui";
import type { PermissionGroupItem, PlayersStats } from "../../../types";

export function PlayersStatsTiles({ stats }: { stats: PlayersStats | null }) {
  const { t } = useTranslation();
  const loading = stats === null;
  return (
    <div className="l-grid--stats">
      <StatTile label={t("players.stats.players")} icon={Users} loading={loading} value={stats?.total_players ?? 0} />
      <StatTile
        label={t("players.stats.pointsInCirculation")}
        icon={Star}
        loading={loading}
        value={(stats?.total_points_in_circulation ?? 0).toLocaleString(undefined)}
      />
      <StatTile
        label={t("players.stats.totalSpent")}
        icon={CreditCard}
        loading={loading}
        value={(stats?.total_spent ?? 0).toLocaleString(undefined)}
      />
      <StatTile
        label={t("players.stats.groups")}
        icon={Shield}
        loading={loading}
        value={stats?.permission_groups_count ?? 0}
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
