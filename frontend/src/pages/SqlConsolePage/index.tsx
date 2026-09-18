/**
 * SqlConsolePage — interactive SQL console for direct database queries.
 *
 * Shell: owns the editor's text, the target database and the two side
 * panels, plus every helper that touches the textarea selection (Tab
 * indentation, Ctrl+Enter, column insertion, replay).
 *
 * Keyboard: Ctrl/Cmd+Enter runs the statement. Tab indents by two spaces,
 * Shift+Tab always moves focus, and Escape releases the trap for the next
 * Tab (WCAG 2.1.2), the way a code editor does.
 *
 * Security: the route is mounted for admins only (App.tsx) and every /sql
 * endpoint is require_admin server side, so there is nothing to gate here.
 */
import { useCallback, useRef, useState, type KeyboardEvent } from "react";
import { SqlConsoleHeader } from "./components/SqlConsoleHeader";
import { QueryEditor } from "./components/QueryEditor";
import { QueryResults } from "./components/QueryResults";
import { TableBrowser } from "./components/TableBrowser";
import { QueryHistory } from "./components/QueryHistory";
import { useQueryExecution } from "./hooks/useQueryExecution";
import { useTableBrowser } from "./hooks/useTableBrowser";
import type { HistoryEntry } from "./sqlTypes";
import type { SqlDatabaseTarget } from "../../services/api";
import type { AuthUser } from "../../types";
import styles from "./SqlConsolePage.module.css";

interface Props {
  // Nothing to gate here: App.tsx mounts this route for admins only and
  // every /sql endpoint is require_admin server side.
  currentUser?: AuthUser | null;
}

export default function SqlConsolePage(_props: Props) {
  const [query, setQuery] = useState("SELECT 1");
  const [database, setDatabase] = useState<SqlDatabaseTarget>("panel");
  const [browserOpen, setBrowserOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Set by Escape: the next Tab moves focus out instead of indenting.
  const tabReleased = useRef(false);

  const browser = useTableBrowser(database);
  const { result, executing, history, executeQuery, clearResult, clearHistory } = useQueryExecution({
    query,
    database,
    loadTables: browser.loadTables,
  });

  // ── Editor helpers (they read and write the textarea selection) ──────────

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== "Tab" && event.key !== "Escape") tabReleased.current = false;

    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      void executeQuery();
      return;
    }
    if (event.key === "Escape") {
      // Escape hatch out of the Tab trap; the next Tab leaves the editor.
      tabReleased.current = true;
      return;
    }
    if (event.key === "Tab") {
      // Shift+Tab always moves focus; Tab does too right after Escape.
      if (event.shiftKey || tabReleased.current) {
        tabReleased.current = false;
        return;
      }
      event.preventDefault();
      const textarea = event.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      setQuery(query.substring(0, start) + "  " + query.substring(end));
      // Restore cursor position after state update
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      });
    }
  }

  /** Insert a column name into the query at the cursor position. */
  const insertColumnName = useCallback(
    (colName: string): void => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const escaped = `\`${colName}\``;
      setQuery(query.substring(0, start) + escaped + query.substring(end));
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = start + escaped.length;
        textarea.focus();
      });
    },
    [query],
  );

  /** Replace the editor with a SELECT * FROM <table> LIMIT 100. */
  const handleTableSelect = useCallback((tableName: string): void => {
    setQuery(`SELECT * FROM \`${tableName}\` LIMIT 100`);
    textareaRef.current?.focus();
  }, []);

  /** Replay a past statement, restoring the database it ran against. */
  const handleReplay = useCallback((entry: HistoryEntry): void => {
    setQuery(entry.query);
    setDatabase(entry.database);
    textareaRef.current?.focus();
  }, []);

  const sideOpen = browserOpen || historyOpen;

  return (
    <div className="l-page">
      <SqlConsoleHeader
        database={database}
        onDatabaseChange={setDatabase}
        browserOpen={browserOpen}
        onToggleBrowser={() => setBrowserOpen((open) => !open)}
        historyOpen={historyOpen}
        onToggleHistory={() => setHistoryOpen((open) => !open)}
        historyCount={history.length}
      />

      <div className={sideOpen ? "l-split" : undefined}>
        <div className="l-stack">
          <QueryEditor
            textareaRef={textareaRef}
            query={query}
            onQueryChange={setQuery}
            onKeyDown={handleKeyDown}
            database={database}
            executing={executing}
            onExecute={() => void executeQuery()}
            onClear={() => {
              setQuery("");
              clearResult();
              textareaRef.current?.focus();
            }}
            result={result}
          />
          {/* The previous result stays visible while the next one runs. */}
          {result && <QueryResults result={result} />}
        </div>

        {/* Both panels stay mounted: the header toggles point at these ids
            with aria-controls, which must resolve while they are closed.
            `hidden` keeps them out of the layout and the tab order. */}
        <div className={`l-stack ${styles.aside}`} hidden={!sideOpen}>
          <div id="sql-table-browser" hidden={!browserOpen}>
            <TableBrowser
              tables={browser.tables}
              loading={browser.tablesLoading}
              expandedTable={browser.expandedTable}
              tableColumns={browser.tableColumns}
              columnsLoading={browser.columnsLoading}
              onTableClick={browser.handleTableClick}
              onTableSelect={handleTableSelect}
              onColumnClick={insertColumnName}
            />
          </div>
          <div id="sql-query-history" hidden={!historyOpen}>
            <QueryHistory history={history} onClear={clearHistory} onReplay={handleReplay} />
          </div>
        </div>
      </div>
    </div>
  );
}
