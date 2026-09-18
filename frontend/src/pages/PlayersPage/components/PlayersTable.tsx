/**
 * PlayersTable — the filter bar, the column filter panel and the table itself.
 *
 * The per-column value filters used to hang off the <th> as an absolutely
 * positioned popup that the scroll wrapper clipped; they are now triggered
 * from a bar above the table and open a panel in normal flow.
 */
import { useTranslation } from "react-i18next";
import { Filter, Users } from "lucide-react";
import {
  Button,
  Checkbox,
  EmptyState,
  SortableHeader,
  Spinner,
  Table,
  TableMessageRow,
  type SortState,
} from "../../../components/ui";
import type { Selection } from "../../../hooks/useSelection";
import type { DiscordAccount } from "../../../services/api";
import type { PlayerListItem } from "../../../types";
import type { ColFilters, ColKey, DistinctValues, SortCol } from "../playersUtils";
import { ColumnFilterPanel } from "./ColumnFilterPanel";
import { PlayerRow } from "./PlayerRow";
import styles from "../PlayersPage.module.css";

const PANEL_ID = "players-column-filter";
const COLUMNS = 7;

/** The three filterable columns, each mapped to the ColKey its panel opens. */
const TRIGGERS: Array<{ id: "tribe" | "groups" | "timed"; open: ColKey; title: string }> = [
  { id: "tribe", open: "tribe", title: "players.table.tribe" },
  { id: "groups", open: "groups", title: "players.table.groups" },
  { id: "timed", open: "timedActive", title: "players.table.timed" },
];

export interface PlayersTableProps {
  loading: boolean;
  rows: PlayerListItem[];
  hasPlayers: boolean;
  selection: Selection<number>;
  activePlayerId: number | null;
  sort: SortState<SortCol>;
  onSort: (key: SortCol) => void;
  colFilters: ColFilters;
  openFilter: ColKey | null;
  distinctValues: DistinctValues;
  activeCount: (key: ColKey | "timed") => number;
  onSetOpenFilter: (key: ColKey | null) => void;
  onToggleColFilterValue: (key: ColKey, value: string) => void;
  onSetColFilterAll: (key: ColKey, values: string[], allOn: boolean) => void;
  onClearColFilter: (key: ColKey) => void;
  discordByEos: Map<string, DiscordAccount>;
  onOpenDetail: (id: number) => void;
  onOpenDiscordChip: (player: PlayerListItem, account: DiscordAccount) => void;
}

export function PlayersTable(p: PlayersTableProps) {
  const { t } = useTranslation();
  const timedOpen = p.openFilter === "timedActive" || p.openFilter === "timedExpired";

  return (
    <>
      <div className={styles.filterBar}>
        <Filter size={16} strokeWidth={1.75} aria-hidden="true" />
        <span className="u-text-sm u-secondary">{t("players.filterPopup.filtersLabel")}</span>
        {TRIGGERS.map(trigger => {
          const count = p.activeCount(trigger.id === "timed" ? "timed" : trigger.open);
          const isOpen = trigger.id === "timed" ? timedOpen : p.openFilter === trigger.open;
          return (
            <Button
              key={trigger.id}
              size="sm"
              // The icon is the non-colour cue that this column is filtered;
              // the count in the label says by how many values.
              icon={count > 0 ? Filter : undefined}
              aria-expanded={isOpen}
              // The panel is only in the document while it is open, so the
              // reference is dropped when it is closed rather than dangling.
              aria-controls={isOpen ? PANEL_ID : undefined}
              onClick={() => p.onSetOpenFilter(isOpen ? null : trigger.open)}
            >
              {count > 0
                ? t("players.filterPopup.triggerActive", { col: t(trigger.title), count })
                : t(trigger.title)}
            </Button>
          );
        })}
      </div>

      <ColumnFilterPanel
        id={PANEL_ID}
        openFilter={p.openFilter}
        colFilters={p.colFilters}
        distinctValues={p.distinctValues}
        onSetOpenFilter={p.onSetOpenFilter}
        onToggleValue={p.onToggleColFilterValue}
        onSetAll={p.onSetColFilterAll}
        onClear={p.onClearColFilter}
      />

      <Table label={t("players.heading")} minWidth={980}>
        <thead>
          <tr>
            <th scope="col">
              <Checkbox
                aria-label={t("players.bulkPerm.selectAllAria")}
                checked={p.selection.allSelected}
                indeterminate={p.selection.someSelected}
                onChange={p.selection.toggleAll}
              />
            </th>
            <SortableHeader label={t("players.table.player")} sortKey="name" sort={p.sort} onSort={p.onSort} />
            <SortableHeader label={t("players.table.tribe")} sortKey="tribe" sort={p.sort} onSort={p.onSort} />
            <SortableHeader label={t("players.table.points")} sortKey="points" sort={p.sort} onSort={p.onSort} />
            <SortableHeader label={t("players.table.groups")} sortKey="groups" sort={p.sort} onSort={p.onSort} />
            <SortableHeader label={t("players.table.timed")} sortKey="timed" sort={p.sort} onSort={p.onSort} />
            <SortableHeader label={t("players.table.login")} sortKey="login" sort={p.sort} onSort={p.onSort} />
          </tr>
        </thead>
        <tbody>
          {p.loading ? (
            <TableMessageRow colSpan={COLUMNS}>
              <Spinner block label={t("players.loading")} />
            </TableMessageRow>
          ) : p.rows.length === 0 ? (
            <TableMessageRow colSpan={COLUMNS}>
              <EmptyState
                icon={Users}
                title={t("players.empty")}
                description={p.hasPlayers ? t("players.emptyFiltered") : undefined}
              />
            </TableMessageRow>
          ) : (
            p.rows.map(player => (
              <PlayerRow
                key={player.id}
                player={player}
                selected={p.selection.isSelected(player.id)}
                active={p.activePlayerId === player.id}
                discordAccount={p.discordByEos.get(player.eos_id)}
                onToggleSelected={() => p.selection.toggle(player.id)}
                onOpen={() => p.onOpenDetail(player.id)}
                onOpenDiscordChip={account => p.onOpenDiscordChip(player, account)}
              />
            ))
          )}
        </tbody>
      </Table>
    </>
  );
}
