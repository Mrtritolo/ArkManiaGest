/**
 * SqlConsolePage.tsx — Interactive SQL console for direct database queries.
 *
 * Features:
 *   - Full SQL editor with monospace font and Ctrl+Enter execution shortcut
 *   - Tabular result grid with horizontal scroll for wide result sets
 *   - Collapsible table browser panel (lists all tables + column schema on click)
 *   - In-session query history with one-click replay
 *   - Execution timing and row count display
 *   - Error display with MariaDB error messages
 *
 * Security:
 *   This page is only accessible to users with the "admin" role.
 *   All queries are executed server-side via the /sql/execute endpoint.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Database,
  Play,
  Clock,
  Table2,
  ChevronRight,
  ChevronDown,
  AlertCircle,
  CheckCircle,
  Trash2,
  Loader2,
} from "lucide-react";
import { sqlConsoleApi } from "../services/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TableInfo {
  name: string;
  engine: string | null;
  row_count: number | null;
  data_size_kb: number | null;
  comment: string | null;
}

interface ColumnInfo {
  name: string;
  data_type: string;
  is_nullable: boolean;
  column_default: string | null;
  column_key: string | null;
  extra: string | null;
  comment: string | null;
}

interface QueryResult {
  success: boolean;
  query: string;
  columns: string[];
  rows: unknown[][];
  row_count: number;
  execution_time_ms: number;
  message: string;
  error: string | null;
}

interface HistoryEntry {
  query: string;
  timestamp: Date;
  success: boolean;
  message: string;
  execution_time_ms: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SqlConsolePage() {
  // ── State ────────────────────────────────────────────────────────────────

  const [query, setQuery] = useState("SELECT 1");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [executing, setExecuting] = useState(false);

  // Table browser
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [expandedTable, setExpandedTable] = useState<string | null>(null);
  const [tableColumns, setTableColumns] = useState<Record<string, ColumnInfo[]>>({});
  const [columnsLoading, setColumnsLoading] = useState<string | null>(null);
  const [browserOpen, setBrowserOpen] = useState(true);

  // Query history (in-session only — not persisted)
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Effects ──────────────────────────────────────────────────────────────

  /** Load the table list on mount. */
  useEffect(() => {
    loadTables();
  }, []);

  // ── Data fetching ────────────────────────────────────────────────────────

  async function loadTables(): Promise<void> {
    setTablesLoading(true);
    try {
      const res = await sqlConsoleApi.tables();
      setTables(res.data);
    } catch {
      /* Table list is non-critical; silently ignore */
    } finally {
      setTablesLoading(false);
    }
  }

  async function loadTableSchema(tableName: string): Promise<void> {
    // Skip if already loaded
    if (tableColumns[tableName]) return;

    setColumnsLoading(tableName);
    try {
      const res = await sqlConsoleApi.tableSchema(tableName);
      setTableColumns((prev) => ({ ...prev, [tableName]: res.data }));
    } catch {
      /* Schema load is non-critical */
    } finally {
      setColumnsLoading(null);
    }
  }

  // ── Query execution ──────────────────────────────────────────────────────

  const executeQuery = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed || executing) return;

    setExecuting(true);
    setResult(null);

    try {
      const res = await sqlConsoleApi.execute(trimmed);
      setResult(res.data);

      // Append to history
      setHistory((prev) => [
        {
          query: trimmed,
          timestamp: new Date(),
          success: res.data.success,
          message: res.data.error || res.data.message,
          execution_time_ms: res.data.execution_time_ms,
        },
        ...prev.slice(0, 49), // Keep at most 50 entries
      ]);

      // Refresh table list after DDL statements
      const upper = trimmed.toUpperCase();
      if (
        upper.startsWith("CREATE") ||
        upper.startsWith("DROP") ||
        upper.startsWith("ALTER") ||
        upper.startsWith("RENAME")
      ) {
        loadTables();
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Query execution failed.";
      setResult({
        success: false,
        query: trimmed,
        columns: [],
        rows: [],
        row_count: 0,
        execution_time_ms: 0,
        message: "",
        error: message,
      });
    } finally {
      setExecuting(false);
    }
  }, [query, executing]);

  // ── Keyboard shortcut: Ctrl+Enter to execute ────────────────────────────

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      executeQuery();
    }
    // Tab inserts spaces instead of changing focus
    if (e.key === "Tab") {
      e.preventDefault();
      const textarea = e.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newValue =
        query.substring(0, start) + "  " + query.substring(end);
      setQuery(newValue);
      // Restore cursor position after state update
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      });
    }
  }

  // ── Table browser helpers ────────────────────────────────────────────────

  function handleTableClick(tableName: string): void {
    if (expandedTable === tableName) {
      setExpandedTable(null);
    } else {
      setExpandedTable(tableName);
      loadTableSchema(tableName);
    }
  }

  /** Insert a SELECT * FROM <table> LIMIT 100 query for the clicked table. */
  function handleTableSelect(tableName: string): void {
    setQuery(`SELECT * FROM \`${tableName}\` LIMIT 100`);
    textareaRef.current?.focus();
  }

  /** Insert a column name into the query at the cursor position. */
  function insertColumnName(colName: string): void {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const escaped = `\`${colName}\``;
    const newQuery =
      query.substring(0, start) + escaped + query.substring(end);
    setQuery(newQuery);
    requestAnimationFrame(() => {
      textarea.selectionStart = textarea.selectionEnd =
        start + escaped.length;
      textarea.focus();
    });
  }

  // ── Cell rendering ───────────────────────────────────────────────────────

  function renderCellValue(value: unknown): string {
    if (value === null || value === undefined) return "NULL";
    if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="page-container">
      {/* Page header */}
      <div className="page-header">
        <div className="page-header-text">
          <h1 className="page-title">
            <Database size={22} /> SQL Console
          </h1>
          <p className="page-subtitle">
            Execute queries directly against the MariaDB database
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            className={`btn btn-sm ${browserOpen ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setBrowserOpen(!browserOpen)}
            title="Toggle table browser"
          >
            <Table2 size={14} /> Tables
          </button>
          <button
            className={`btn btn-sm ${historyOpen ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setHistoryOpen(!historyOpen)}
            title="Toggle query history"
          >
            <Clock size={14} /> History ({history.length})
          </button>
        </div>
      </div>

      <div
        style={{ display: "flex", gap: "1rem", alignItems: "flex-start" }}
      >
        {/* ── Main panel ─────────────────────────────────────────────── */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Query editor */}
          <div className="card">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "0.75rem",
              }}
            >
              <h2 className="card-title" style={{ margin: 0 }}>
                <span className="card-title-icon">&#x25B6;</span>
                Query Editor
              </h2>
              <span
                style={{
                  fontSize: "0.75rem",
                  color: "var(--text-muted)",
                }}
              >
                Ctrl + Enter to execute
              </span>
            </div>

            <textarea
              ref={textareaRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              spellCheck={false}
              placeholder="Type your SQL query here..."
              style={{
                width: "100%",
                minHeight: "140px",
                maxHeight: "400px",
                resize: "vertical",
                fontFamily: "var(--font-mono)",
                fontSize: "0.88rem",
                lineHeight: "1.6",
                padding: "0.75rem",
                background: "var(--bg-input)",
                border: "1px solid var(--border-input)",
                borderRadius: "var(--radius)",
                color: "var(--text-primary)",
                outline: "none",
                tabSize: 2,
              }}
            />

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                marginTop: "0.75rem",
              }}
            >
              <button
                className="btn btn-primary"
                onClick={executeQuery}
                disabled={executing || !query.trim()}
              >
                {executing ? (
                  <>
                    <Loader2 size={14} className="pl-spin" /> Executing…
                  </>
                ) : (
                  <>
                    <Play size={14} /> Execute
                  </>
                )}
              </button>

              <button
                className="btn btn-ghost"
                onClick={() => {
                  setQuery("");
                  setResult(null);
                  textareaRef.current?.focus();
                }}
                title="Clear editor and results"
              >
                <Trash2 size={14} /> Clear
              </button>

              {/* Execution summary */}
              {result && (
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.35rem",
                    fontSize: "0.82rem",
                    color: result.success
                      ? "var(--success)"
                      : "var(--danger)",
                    marginLeft: "auto",
                  }}
                >
                  {result.success ? (
                    <CheckCircle size={14} />
                  ) : (
                    <AlertCircle size={14} />
                  )}
                  {result.success
                    ? `${result.message} — ${result.execution_time_ms.toFixed(1)} ms`
                    : "Query failed"}
                </span>
              )}
            </div>
          </div>

          {/* ── Results ──────────────────────────────────────────────── */}
          {result && (
            <div className="card" style={{ marginTop: "1rem" }}>
              <h2 className="card-title">
                <span className="card-title-icon">&#x25C9;</span>
                Results
              </h2>

              {/* Error display */}
              {result.error && (
                <div
                  className="alert alert-error"
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "0.82rem",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  <AlertCircle
                    size={14}
                    style={{ flexShrink: 0, marginTop: "0.15rem" }}
                  />
                  <div>{result.error}</div>
                </div>
              )}

              {/* Data grid */}
              {result.success && result.columns.length > 0 && (
                <div
                  style={{
                    overflowX: "auto",
                    maxHeight: "500px",
                    overflowY: "auto",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius)",
                  }}
                >
                  <table className="data-table" style={{ minWidth: "100%" }}>
                    <thead>
                      <tr>
                        <th
                          style={{
                            width: "3.5rem",
                            textAlign: "center",
                            color: "var(--text-muted)",
                            fontWeight: 500,
                          }}
                        >
                          #
                        </th>
                        {result.columns.map((col) => (
                          <th key={col}>{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((row, rowIdx) => (
                        <tr key={rowIdx}>
                          <td
                            style={{
                              textAlign: "center",
                              color: "var(--text-muted)",
                              fontSize: "0.78rem",
                            }}
                          >
                            {rowIdx + 1}
                          </td>
                          {row.map((cell, colIdx) => (
                            <td
                              key={colIdx}
                              style={{
                                fontFamily: "var(--font-mono)",
                                fontSize: "0.82rem",
                                whiteSpace: "nowrap",
                                maxWidth: "300px",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                ...(cell === null
                                  ? {
                                      color: "var(--text-muted)",
                                      fontStyle: "italic",
                                    }
                                  : {}),
                              }}
                              title={renderCellValue(cell)}
                            >
                              {renderCellValue(cell)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* DML result (no columns) */}
              {result.success && result.columns.length === 0 && (
                <p
                  style={{
                    color: "var(--success)",
                    fontSize: "0.88rem",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.35rem",
                  }}
                >
                  <CheckCircle size={14} />
                  {result.message} — {result.execution_time_ms.toFixed(1)} ms
                </p>
              )}
            </div>
          )}
        </div>

        {/* ── Side panel: table browser / history ────────────────────── */}
        {(browserOpen || historyOpen) && (
          <div style={{ width: "280px", flexShrink: 0 }}>
            {/* Table browser */}
            {browserOpen && (
              <div
                className="card"
                style={{ maxHeight: "50vh", overflowY: "auto" }}
              >
                <h2
                  className="card-title"
                  style={{ fontSize: "0.85rem" }}
                >
                  <span className="card-title-icon">
                    <Table2 size={14} />
                  </span>
                  Tables
                  {!tablesLoading && (
                    <span
                      style={{
                        marginLeft: "auto",
                        fontSize: "0.75rem",
                        color: "var(--text-muted)",
                        fontWeight: 400,
                      }}
                    >
                      {tables.length}
                    </span>
                  )}
                </h2>

                {tablesLoading ? (
                  <p
                    style={{
                      color: "var(--text-muted)",
                      fontSize: "0.82rem",
                    }}
                  >
                    Loading…
                  </p>
                ) : (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "1px",
                    }}
                  >
                    {tables.map((t) => (
                      <div key={t.name}>
                        {/* Table row */}
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.35rem",
                            padding: "0.3rem 0.4rem",
                            borderRadius: "4px",
                            cursor: "pointer",
                            fontSize: "0.8rem",
                            fontFamily: "var(--font-mono)",
                            color: "var(--text-secondary)",
                            background:
                              expandedTable === t.name
                                ? "var(--bg-active)"
                                : "transparent",
                          }}
                          onClick={() => handleTableClick(t.name)}
                          onDoubleClick={() => handleTableSelect(t.name)}
                          title={`Double-click to SELECT from ${t.name}`}
                        >
                          {expandedTable === t.name ? (
                            <ChevronDown size={12} />
                          ) : (
                            <ChevronRight size={12} />
                          )}
                          <span
                            style={{
                              flex: 1,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {t.name}
                          </span>
                          {t.row_count !== null && (
                            <span
                              style={{
                                fontSize: "0.7rem",
                                color: "var(--text-muted)",
                              }}
                            >
                              {t.row_count}
                            </span>
                          )}
                        </div>

                        {/* Expanded column list */}
                        {expandedTable === t.name && (
                          <div
                            style={{
                              paddingLeft: "1.2rem",
                              paddingBottom: "0.3rem",
                            }}
                          >
                            {columnsLoading === t.name ? (
                              <span
                                style={{
                                  fontSize: "0.75rem",
                                  color: "var(--text-muted)",
                                }}
                              >
                                Loading…
                              </span>
                            ) : (
                              (tableColumns[t.name] || []).map((col) => (
                                <div
                                  key={col.name}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "0.3rem",
                                    padding: "0.15rem 0.3rem",
                                    borderRadius: "3px",
                                    fontSize: "0.75rem",
                                    fontFamily: "var(--font-mono)",
                                    cursor: "pointer",
                                  }}
                                  onClick={() =>
                                    insertColumnName(col.name)
                                  }
                                  title={`${col.data_type}${col.column_key === "PRI" ? " — PRIMARY KEY" : ""}${col.extra === "auto_increment" ? " AUTO_INCREMENT" : ""}. Click to insert.`}
                                  className="sql-col-row"
                                >
                                  {/* Key badge */}
                                  {col.column_key === "PRI" && (
                                    <span
                                      style={{
                                        fontSize: "0.6rem",
                                        fontWeight: 700,
                                        color: "var(--warning)",
                                      }}
                                    >
                                      PK
                                    </span>
                                  )}
                                  {col.column_key === "MUL" && (
                                    <span
                                      style={{
                                        fontSize: "0.6rem",
                                        fontWeight: 700,
                                        color: "var(--text-muted)",
                                      }}
                                    >
                                      FK
                                    </span>
                                  )}
                                  {col.column_key === "UNI" && (
                                    <span
                                      style={{
                                        fontSize: "0.6rem",
                                        fontWeight: 700,
                                        color: "var(--accent)",
                                      }}
                                    >
                                      UQ
                                    </span>
                                  )}

                                  <span
                                    style={{
                                      color: "var(--text-primary)",
                                    }}
                                  >
                                    {col.name}
                                  </span>
                                  <span
                                    style={{
                                      marginLeft: "auto",
                                      color: "var(--text-muted)",
                                      fontSize: "0.68rem",
                                    }}
                                  >
                                    {col.data_type}
                                  </span>
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Query history */}
            {historyOpen && (
              <div
                className="card"
                style={{
                  marginTop: browserOpen ? "1rem" : 0,
                  maxHeight: "40vh",
                  overflowY: "auto",
                }}
              >
                <h2
                  className="card-title"
                  style={{ fontSize: "0.85rem" }}
                >
                  <span className="card-title-icon">
                    <Clock size={14} />
                  </span>
                  History
                  {history.length > 0 && (
                    <button
                      className="btn btn-ghost btn-xs"
                      style={{ marginLeft: "auto" }}
                      onClick={() => setHistory([])}
                      title="Clear history"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </h2>

                {history.length === 0 ? (
                  <p
                    style={{
                      color: "var(--text-muted)",
                      fontSize: "0.82rem",
                    }}
                  >
                    No queries yet.
                  </p>
                ) : (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.4rem",
                    }}
                  >
                    {history.map((entry, idx) => (
                      <div
                        key={idx}
                        style={{
                          padding: "0.4rem",
                          borderRadius: "4px",
                          border: "1px solid var(--border)",
                          cursor: "pointer",
                          fontSize: "0.75rem",
                        }}
                        onClick={() => {
                          setQuery(entry.query);
                          textareaRef.current?.focus();
                        }}
                        title="Click to load this query into the editor"
                      >
                        <div
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: "0.72rem",
                            color: "var(--text-secondary)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            maxWidth: "240px",
                          }}
                        >
                          {entry.query}
                        </div>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.35rem",
                            marginTop: "0.2rem",
                            fontSize: "0.68rem",
                            color: entry.success
                              ? "var(--success)"
                              : "var(--danger)",
                          }}
                        >
                          {entry.success ? (
                            <CheckCircle size={10} />
                          ) : (
                            <AlertCircle size={10} />
                          )}
                          <span>{entry.message}</span>
                          <span
                            style={{
                              marginLeft: "auto",
                              color: "var(--text-muted)",
                            }}
                          >
                            {entry.execution_time_ms.toFixed(0)} ms
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
