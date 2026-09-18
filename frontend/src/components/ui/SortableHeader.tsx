import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cx } from "./cx";
import "./Table.css";

export type SortDir = "asc" | "desc";

export interface SortState<K extends string> {
  key: K;
  dir: SortDir;
}

export interface SortableHeaderProps<K extends string> {
  label: string;
  sortKey: K;
  sort: SortState<K> | null;
  onSort: (key: K) => void;
  /** 'end' for numeric columns. */
  align?: "start" | "end";
}

/** Same key toggles asc/desc; a new key starts ascending. */
export function nextSort<K extends string>(current: SortState<K> | null, key: K): SortState<K> {
  if (current && current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: "asc" };
}

/**
 * <th> with a full-cell sort button. aria-sort is set on the sorted column
 * only (WAI-ARIA APG) and is the single state announcement.
 */
export function SortableHeader<K extends string>({ label, sortKey, sort, onSort, align = "start" }: SortableHeaderProps<K>) {
  const active = sort !== null && sort.key === sortKey;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      className={cx("ui-th-sort", align === "end" && "u-text-end")}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
    >
      <button
        type="button"
        className={cx("ui-sort-btn", align === "end" && "ui-sort-btn--end")}
        data-active={active || undefined}
        onClick={() => onSort(sortKey)}
      >
        <span>{label}</span>
        <Icon aria-hidden="true" />
      </button>
    </th>
  );
}
