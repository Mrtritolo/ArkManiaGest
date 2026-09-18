/**
 * useTableBrowser -- the table list and per-table column schema of the
 * currently selected database.
 *
 * Switching the target resets the list and reloads it. There is no request
 * cancellation: a schema request issued for the previous target can still
 * land, which is why every response is checked against `databaseRef` before
 * it is stored (existing behaviour, deliberately unchanged by the split).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { sqlConsoleApi, type SqlDatabaseTarget } from "../../../services/api";
import type { ColumnInfo, TableInfo } from "../sqlTypes";

export interface TableBrowser {
  tables: TableInfo[];
  tablesLoading: boolean;
  expandedTable: string | null;
  tableColumns: Record<string, ColumnInfo[]>;
  columnsLoading: string | null;
  loadTables: () => Promise<void>;
  handleTableClick: (tableName: string) => void;
}

export function useTableBrowser(database: SqlDatabaseTarget): TableBrowser {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [expandedTable, setExpandedTable] = useState<string | null>(null);
  const [tableColumns, setTableColumns] = useState<Record<string, ColumnInfo[]>>({});
  const [columnsLoading, setColumnsLoading] = useState<string | null>(null);

  // The target the browser shows.  A table list or schema that arrives for
  // another target is dropped, so the browser never lists one database's
  // tables under the other's button.
  const databaseRef = useRef<SqlDatabaseTarget>(database);
  // Read by loadTableSchema without making it a dependency of the callback.
  const columnsRef = useRef(tableColumns);
  columnsRef.current = tableColumns;
  // Mirrors expandedTable so the toggle can decide outside the state updater:
  // an updater must stay pure (StrictMode double-invokes it, which used to
  // fire the schema request twice).
  const expandedRef = useRef<string | null>(null);

  const loadTables = useCallback(async (): Promise<void> => {
    const target = databaseRef.current;
    setTablesLoading(true);
    try {
      const res = await sqlConsoleApi.tables(target);
      if (target === databaseRef.current) setTables(res.data);
    } catch {
      /* Table list is non-critical; the list stays empty */
    } finally {
      if (target === databaseRef.current) setTablesLoading(false);
    }
  }, []);

  const loadTableSchema = useCallback(async (tableName: string): Promise<void> => {
    // Skip if already loaded
    if (columnsRef.current[tableName]) return;

    const target = databaseRef.current;
    setColumnsLoading(tableName);
    try {
      const res = await sqlConsoleApi.tableSchema(tableName, target);
      if (target === databaseRef.current) {
        setTableColumns((prev) => ({ ...prev, [tableName]: res.data }));
      }
    } catch {
      /* Schema load is non-critical */
    } finally {
      setColumnsLoading(null);
    }
  }, []);

  /** Load the table list on mount and whenever the target database changes. */
  useEffect(() => {
    databaseRef.current = database;
    expandedRef.current = null;
    setExpandedTable(null);
    setTableColumns({});
    setTables([]);
    void loadTables();
    // loadTables is stable (useCallback with no deps); listing it would not
    // change when this effect runs, and the dep list stays [database] as before.
  }, [database, loadTables]);

  const handleTableClick = useCallback(
    (tableName: string): void => {
      const next = expandedRef.current === tableName ? null : tableName;
      expandedRef.current = next;
      setExpandedTable(next);
      if (next) void loadTableSchema(next);
    },
    [loadTableSchema],
  );

  return {
    tables,
    tablesLoading,
    expandedTable,
    tableColumns,
    columnsLoading,
    loadTables,
    handleTableClick,
  };
}
