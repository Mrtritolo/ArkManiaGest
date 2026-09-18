/**
 * useColumnFilters — Excel-style per-column filters plus the table sort.
 *
 * An empty Set means "no filter on this column"; ticking values narrows the
 * rows with ANY-match semantics. The filtered list is memoised on the players
 * and the filter sets, the sorted list on top of it.
 */
import { useCallback, useMemo, useState } from "react";
import type { SortState } from "../../../components/ui";
import type { PlayerListItem } from "../../../types";
import {
  computeDistinctValues,
  passesFilter,
  sortPlayers,
  type ColFilters,
  type ColKey,
  type SortCol,
} from "../playersUtils";

const EMPTY_FILTERS = (): ColFilters => ({
  tribe: new Set<string>(),
  groups: new Set<string>(),
  timedActive: new Set<string>(),
  timedExpired: new Set<string>(),
});

export function useColumnFilters(players: PlayerListItem[]) {
  const [colFilters, setColFilters] = useState<ColFilters>(EMPTY_FILTERS);
  /** Which column's filter panel is open (null = none). */
  const [openFilter, setOpenFilter] = useState<ColKey | null>(null);
  const [sort, setSort] = useState<SortState<SortCol>>({ key: "name", dir: "asc" });

  const distinctValues = useMemo(() => computeDistinctValues(players), [players]);

  const filteredPlayers = useMemo(
    () => players.filter(p => passesFilter(p, colFilters)),
    [players, colFilters],
  );

  const sortedPlayers = useMemo(
    () => sortPlayers(filteredPlayers, sort.key, sort.dir),
    [filteredPlayers, sort],
  );

  const visibleIds = useMemo(() => sortedPlayers.map(p => p.id), [sortedPlayers]);

  const toggleSort = useCallback((key: SortCol) => {
    setSort(prev => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }, []);

  const clearColFilter = useCallback((key: ColKey) => {
    setColFilters(prev => ({ ...prev, [key]: new Set<string>() }));
  }, []);

  const toggleColFilterValue = useCallback((key: ColKey, value: string) => {
    setColFilters(prev => {
      const next = new Set(prev[key]);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return { ...prev, [key]: next };
    });
  }, []);

  /**
   * Select / deselect exactly `values`. The panel passes the values its own
   * search box is showing, so "(Select all)" while searching no longer ticks
   * the options the operator cannot see.
   */
  const setColFilterAll = useCallback((key: ColKey, values: string[], allOn: boolean) => {
    setColFilters(prev => {
      const next = new Set(prev[key]);
      for (const v of values) {
        if (allOn) next.add(v);
        else next.delete(v);
      }
      return { ...prev, [key]: next };
    });
  }, []);

  /** How many values are ticked on the trigger's column (timed counts both halves). */
  const activeCount = useCallback(
    (key: ColKey | "timed"): number =>
      key === "timed"
        ? colFilters.timedActive.size + colFilters.timedExpired.size
        : colFilters[key].size,
    [colFilters],
  );

  return {
    colFilters,
    openFilter,
    setOpenFilter,
    sort,
    toggleSort,
    distinctValues,
    filteredPlayers,
    sortedPlayers,
    visibleIds,
    clearColFilter,
    toggleColFilterValue,
    setColFilterAll,
    activeCount,
  };
}
