/**
 * TableBrowser -- the table list of the selected database. Every entry is a
 * real button: the name expands the column schema, the play action inserts a
 * SELECT, and each column inserts its own name at the cursor.
 */
import { ChevronDown, ChevronRight, SquareArrowOutUpRight, Table2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, EmptyState, IconButton, Spinner } from "../../../components/ui";
import type { ColumnInfo, TableInfo } from "../sqlTypes";
import styles from "../SqlConsolePage.module.css";

interface Props {
  tables: TableInfo[];
  loading: boolean;
  expandedTable: string | null;
  tableColumns: Record<string, ColumnInfo[]>;
  columnsLoading: string | null;
  onTableClick: (name: string) => void;
  onTableSelect: (name: string) => void;
  onColumnClick: (name: string) => void;
}

/** Visible short marker plus the spoken word for a key column. */
function keyMarker(columnKey: string | null): { short: string; key: string } | null {
  if (columnKey === "PRI") return { short: "PK", key: "sqlConsole.browser.primaryKey" };
  if (columnKey === "MUL") return { short: "FK", key: "sqlConsole.browser.indexedKey" };
  if (columnKey === "UNI") return { short: "UQ", key: "sqlConsole.browser.uniqueKey" };
  return null;
}

export function TableBrowser({
  tables,
  loading,
  expandedTable,
  tableColumns,
  columnsLoading,
  onTableClick,
  onTableSelect,
  onColumnClick,
}: Props) {
  const { t } = useTranslation();

  return (
    <Card
      title={t("sqlConsole.browser.title")}
      titleAs="h3"
      icon={Table2}
      className={styles.sidePanel}
      actions={loading ? <Spinner /> : <span className="ui-count">{tables.length}</span>}
    >
      {loading && tables.length === 0 ? (
        <Spinner block label={t("sqlConsole.browser.loading")} />
      ) : tables.length === 0 ? (
        <EmptyState icon={Table2} title={t("sqlConsole.browser.empty")} />
      ) : (
        <ul className={styles.tableList}>
          {tables.map((tbl) => {
            const expanded = expandedTable === tbl.name;
            const columnsId = `sql-cols-${tbl.name}`;
            return (
              <li key={tbl.name}>
                <div className={styles.tableRow} data-expanded={expanded || undefined}>
                  <button
                    type="button"
                    className={styles.tableToggle}
                    aria-expanded={expanded}
                    aria-controls={columnsId}
                    onClick={() => onTableClick(tbl.name)}
                    onDoubleClick={() => onTableSelect(tbl.name)}
                  >
                    {expanded ? (
                      <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
                    ) : (
                      <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
                    )}
                    <span className="u-mono u-truncate">{tbl.name}</span>
                    {tbl.row_count !== null && (
                      <span className="ui-count u-push">{tbl.row_count}</span>
                    )}
                  </button>
                  <IconButton
                    size="sm"
                    icon={SquareArrowOutUpRight}
                    label={t("sqlConsole.browser.selectAction", { name: tbl.name })}
                    onClick={() => onTableSelect(tbl.name)}
                  />
                </div>

                <div id={columnsId} hidden={!expanded} className={styles.columnList}>
                  {columnsLoading === tbl.name ? (
                    <Spinner label={t("sqlConsole.browser.loading")} />
                  ) : (
                    (tableColumns[tbl.name] || []).map((col) => {
                      const marker = keyMarker(col.column_key);
                      const suffix =
                        (col.column_key === "PRI" ? t("sqlConsole.browser.pkSuffix") : "") +
                        (col.extra === "auto_increment" ? t("sqlConsole.browser.autoIncSuffix") : "");
                      return (
                        <button
                          key={col.name}
                          type="button"
                          className={styles.columnRow}
                          title={t("sqlConsole.browser.colTitle", { type: col.data_type, suffix })}
                          onClick={() => onColumnClick(col.name)}
                        >
                          {marker && (
                            <span className={styles.keyMark}>
                              <span aria-hidden="true">{marker.short}</span>
                              <span className="u-sr-only">{t(marker.key)}</span>
                            </span>
                          )}
                          <span className="u-mono u-truncate">{col.name}</span>
                          <span className="u-mono u-muted u-push">{col.data_type}</span>
                        </button>
                      );
                    })
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
