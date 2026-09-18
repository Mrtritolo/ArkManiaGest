/**
 * ColumnFilterPanel — the Excel-style value filter for one table column.
 *
 * It used to be an absolutely positioned popup inside a <th>, which the table
 * wrapper clipped as soon as the filtered table got short. It is now a panel
 * that opens in normal flow between the card header and the table, so the
 * whole option list is always reachable (and scrollable) at any height.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Button, Checkbox, IconButton, Input, SegmentedControl } from "../../../components/ui";
import { NO_VALUE_KEY, type ColFilters, type ColKey, type DistinctValues } from "../playersUtils";
import styles from "../PlayersPage.module.css";

/** Column title + "(no value)" label per filterable column. */
const COLUMN_KEYS: Record<ColKey, { title: string; empty: string }> = {
  tribe: { title: "players.table.tribe", empty: "players.filterPopup.noValueTribe" },
  groups: { title: "players.table.groups", empty: "players.filterPopup.noValueGroups" },
  timedActive: { title: "players.table.timed", empty: "players.filterPopup.noValueTimedActive" },
  timedExpired: { title: "players.table.timed", empty: "players.filterPopup.noValueTimedExpired" },
};

export interface ColumnFilterPanelProps {
  openFilter: ColKey | null;
  colFilters: ColFilters;
  distinctValues: DistinctValues;
  onSetOpenFilter: (key: ColKey | null) => void;
  onToggleValue: (key: ColKey, value: string) => void;
  onSetAll: (key: ColKey, values: string[], allOn: boolean) => void;
  onClear: (key: ColKey) => void;
  /** Id the header trigger points at with aria-controls. */
  id: string;
}

export function ColumnFilterPanel({
  openFilter,
  colFilters,
  distinctValues,
  onSetOpenFilter,
  onToggleValue,
  onSetAll,
  onClear,
  id,
}: ColumnFilterPanelProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const wasOpen = useRef(false);

  // A new column starts with a clean search box; the caret moves into it only
  // when the panel opens, so switching the Active/Expired segment does not
  // steal focus from the segment the operator just pressed.
  useEffect(() => {
    if (!openFilter) {
      wasOpen.current = false;
      return;
    }
    setSearch("");
    if (!wasOpen.current) searchRef.current?.focus();
    wasOpen.current = true;
  }, [openFilter]);

  if (!openFilter) return null;

  const isTimed = openFilter === "timedActive" || openFilter === "timedExpired";
  const options = distinctValues[openFilter];
  const selected = colFilters[openFilter];
  const labels = COLUMN_KEYS[openFilter];

  const visible = options.filter(opt => {
    if (!search) return true;
    const label = opt === NO_VALUE_KEY ? t(labels.empty) : opt;
    return label.toLowerCase().includes(search.toLowerCase());
  });
  const allSelected = visible.length > 0 && visible.every(o => selected.has(o));
  const someSelected = visible.some(o => selected.has(o)) && !allSelected;

  return (
    <section
      className={styles.filterPanel}
      id={id}
      aria-label={t("players.filterPopup.panelLabel", { col: t(labels.title) })}
      // Scoped to the panel on purpose: a document-level listener is not part
      // of the dialog stack, so one Escape would also close a Modal opened on
      // top of it. Focus lands in the search box when the panel opens.
      onKeyDown={e => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onSetOpenFilter(null);
        }
      }}
    >
      <div className={styles.filterHead}>
        <strong className="u-text-sm">{t(labels.title)}</strong>
        {isTimed && (
          <SegmentedControl
            size="sm"
            label={t("players.filterPopup.timedScope")}
            options={[
              {
                value: "timedActive",
                label: colFilters.timedActive.size > 0
                  ? `${t("players.filterPopup.tabActive")} (${colFilters.timedActive.size})`
                  : t("players.filterPopup.tabActive"),
              },
              {
                value: "timedExpired",
                label: colFilters.timedExpired.size > 0
                  ? `${t("players.filterPopup.tabExpired")} (${colFilters.timedExpired.size})`
                  : t("players.filterPopup.tabExpired"),
              },
            ]}
            value={openFilter}
            onChange={v => onSetOpenFilter(v as ColKey)}
          />
        )}
        <Input
          ref={searchRef}
          type="search"
          size="sm"
          aria-label={t("players.filterPopup.search")}
          placeholder={t("players.filterPopup.search")}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <Checkbox
          label={t("players.filterPopup.selectAll")}
          checked={allSelected}
          indeterminate={someSelected}
          onChange={() => onSetAll(openFilter, visible, !allSelected)}
        />
        <Button size="sm" className="u-push" onClick={() => onClear(openFilter)}>
          {t("players.filterPopup.clear")}
        </Button>
        <IconButton size="sm" icon={X} label={t("common.close")} onClick={() => onSetOpenFilter(null)} />
      </div>

      <div className={styles.filterList}>
        {visible.length === 0 ? (
          <p className={styles.filterEmpty}>{t("players.filterPopup.noMatches")}</p>
        ) : (
          visible.map(opt => (
            <Checkbox
              key={opt}
              label={
                opt === NO_VALUE_KEY ? <span className={styles.noValue}>{t(labels.empty)}</span> : opt
              }
              checked={selected.has(opt)}
              onChange={() => onToggleValue(openFilter, opt)}
            />
          ))
        )}
      </div>
    </section>
  );
}
