/**
 * useQueryExecution -- runs the editor's statement against the selected
 * database and keeps the in-session history.
 *
 * Guard rails:
 *   - anything that deletes or rewrites data is confirmed first, with the
 *     target database typed back (the server runs with autocommit);
 *   - the previous result stays on screen while a statement executes;
 *   - failures are recorded in the history too, and a client-side timeout is
 *     reported as "may still have completed", because the server commits
 *     independently of the browser.
 */
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { sqlConsoleApi, type SqlDatabaseTarget } from "../../../services/api";
import { extractError } from "../../../utils/errors";
import { useConfirm } from "../../../components/ui";
import { destructiveVerbs, MAX_HISTORY, type HistoryEntry, type QueryResult } from "../sqlTypes";

interface Options {
  query: string;
  database: SqlDatabaseTarget;
  loadTables: () => Promise<void>;
}

export interface QueryExecution {
  result: QueryResult | null;
  executing: boolean;
  history: HistoryEntry[];
  executeQuery: () => Promise<void>;
  clearResult: () => void;
  clearHistory: () => void;
}

/** Translated name of a target, used in prompts and badges. */
export function databaseLabelKey(database: SqlDatabaseTarget): string {
  return database === "plugin" ? "sqlConsole.db.plugin" : "sqlConsole.db.panel";
}

export function useQueryExecution({ query, database, loadTables }: Options): QueryExecution {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [result, setResult] = useState<QueryResult | null>(null);
  const [executing, setExecuting] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  // `executing` only turns true once the confirmation is settled, so it cannot
  // guard the window in which the dialog is open. A second Ctrl+Enter would
  // otherwise queue a second dialog and run the same DELETE twice.
  const busy = useRef(false);

  const record = useCallback((entry: HistoryEntry) => {
    setHistory((prev) => [entry, ...prev.slice(0, MAX_HISTORY - 1)]);
  }, []);

  const executeQuery = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed || executing || busy.current) return;
    busy.current = true;

    try {
      const dbLabel = t(databaseLabelKey(database));

      // Ctrl+Enter sends the editor as it is, e.g. a DELETE typed before its
      // WHERE clause: ask before anything that deletes or rewrites data, and
      // make the operator type the target back so a wrong target is caught.
      const risky = destructiveVerbs(trimmed);
      if (risky.length > 0) {
        const ok = await confirm({
          title: t("sqlConsole.confirmDestructiveTitle", { verbs: risky.join(", ") }),
          description: t("sqlConsole.confirmDestructive", {
            verbs: risky.join(", "),
            database: dbLabel,
          }),
          confirmLabel: t("sqlConsole.confirmDestructiveRun"),
          tone: "danger",
          confirmText: dbLabel,
        });
        if (!ok) return;
      }

      setExecuting(true);

      try {
        const res = await sqlConsoleApi.execute(trimmed, database);
        setResult(res.data);
        record({
          query: trimmed,
          database,
          timestamp: new Date(),
          success: res.data.success,
          message: res.data.error || res.data.message,
          execution_time_ms: res.data.execution_time_ms,
        });

        // Refresh table list after DDL statements
        const upper = trimmed.toUpperCase();
        if (
          upper.startsWith("CREATE") ||
          upper.startsWith("DROP") ||
          upper.startsWith("ALTER") ||
          upper.startsWith("RENAME")
        ) {
          void loadTables();
        }
      } catch (err: unknown) {
        // The request never came back, but the statement may well have run:
        // the server commits on its own clock (autocommit + its own timeout).
        const abandoned = (err as { code?: string })?.code === "ECONNABORTED";
        const message = abandoned
          ? t("sqlConsole.errors.timeout")
          : extractError(err, t("sqlConsole.errors.executeFailed"));
        setResult({
          success: false,
          query: trimmed,
          columns: [],
          rows: [],
          row_count: 0,
          truncated: false,
          execution_time_ms: 0,
          message: "",
          error: message,
        });
        record({
          query: trimmed,
          database,
          timestamp: new Date(),
          success: false,
          message,
          execution_time_ms: 0,
        });
      } finally {
        setExecuting(false);
      }
    } finally {
      busy.current = false;
    }
  }, [query, executing, database, t, confirm, loadTables, record]);

  const clearResult = useCallback(() => setResult(null), []);
  const clearHistory = useCallback(() => setHistory([]), []);

  return { result, executing, history, executeQuery, clearResult, clearHistory };
}
