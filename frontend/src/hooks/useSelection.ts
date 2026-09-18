/**
 * useSelection -- row selection for bulk actions.
 *
 * Keys that are no longer visible (page change, filter, search) are dropped,
 * so a bulk action never touches rows the user cannot see. Reads are always
 * the intersection with `visibleKeys`; the stored set is pruned right after.
 *
 *     const sel = useSelection(rows.map(r => r.id))
 *     <Checkbox aria-label={t('players.selectAll')} checked={sel.allSelected}
 *               indeterminate={sel.someSelected} onChange={sel.toggleAll} />
 *     <tr data-selected={sel.isSelected(r.id) || undefined}>
 */
import { useCallback, useEffect, useMemo, useState } from "react";

export interface Selection<K> {
  selected: ReadonlySet<K>;
  isSelected(key: K): boolean;
  toggle(key: K): void;
  toggleAll(): void;
  clear(): void;
  allSelected: boolean;
  someSelected: boolean;
  count: number;
}

export function useSelection<K extends string | number>(visibleKeys: readonly K[]): Selection<K> {
  const [stored, setStored] = useState<ReadonlySet<K>>(() => new Set<K>());
  const visible = useMemo(() => new Set(visibleKeys), [visibleKeys]);

  const selected = useMemo<ReadonlySet<K>>(() => {
    const next = new Set<K>();
    for (const key of stored) if (visible.has(key)) next.add(key);
    return next;
  }, [stored, visible]);

  useEffect(() => {
    if (selected.size !== stored.size) setStored(selected);
  }, [selected, stored]);

  const toggle = useCallback((key: K) => {
    setStored(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const count = selected.size;
  const allSelected = visible.size > 0 && count === visible.size;

  const toggleAll = useCallback(() => {
    setStored(allSelected ? new Set<K>() : new Set(visible));
  }, [allSelected, visible]);

  const clear = useCallback(() => setStored(new Set<K>()), []);
  const isSelected = useCallback((key: K) => selected.has(key), [selected]);

  return {
    selected,
    isSelected,
    toggle,
    toggleAll,
    clear,
    allSelected,
    someSelected: count > 0 && !allSelected,
    count,
  };
}
