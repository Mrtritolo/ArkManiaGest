/**
 * sqlTypes.ts -- shapes returned by /sql/* plus the in-session history entry.
 *
 * The axios client returns `any` for these endpoints, so the page owns the
 * types; keep them in sync with `backend/app/api/routes/sql_console.py`.
 */
import type { SqlDatabaseTarget } from "../../services/api";

export interface TableInfo {
  name: string;
  engine: string | null;
  row_count: number | null;
  data_size_kb: number | null;
  comment: string | null;
}

export interface ColumnInfo {
  name: string;
  data_type: string;
  is_nullable: boolean;
  column_default: string | null;
  column_key: string | null;
  extra: string | null;
  comment: string | null;
}

export interface QueryResult {
  success: boolean;
  query: string;
  columns: string[];
  rows: unknown[][];
  row_count: number;
  /** True when the server stopped reading rows at its cap (1000 rows / 8M chars). */
  truncated: boolean;
  execution_time_ms: number;
  message: string;
  error: string | null;
}

export interface HistoryEntry {
  query: string;
  /** Replay restores the target too: the same statement is not safe on both. */
  database: SqlDatabaseTarget;
  timestamp: Date;
  success: boolean;
  message: string;
  execution_time_ms: number;
}

/** Rows put in the grid; more than this and the tab stalls building cells. */
export const MAX_RENDER_ROWS = 1000;

/** History depth (in-session only, never persisted). */
export const MAX_HISTORY = 50;

// Statements that delete or rewrite data.  The server runs every query with
// autocommit, so there is no undo once one has been sent.
const DESTRUCTIVE_VERBS = new Set(["DELETE", "UPDATE", "DROP", "TRUNCATE", "ALTER", "RENAME", "REPLACE"]);

/** Leading verb of each statement in the batch that is destructive. */
export function destructiveVerbs(sql: string): string[] {
  // Strip quoted strings, quoted identifiers and comments first, so a ';'
  // or a verb inside them is not taken for a statement.
  const code = sql.replace(
    /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`[^`]*`|\/\*[\s\S]*?\*\/|(?:#|--(?=\s|$))[^\n]*/g,
    " ",
  );
  const verbs = code
    .split(";")
    .map((stmt) => {
      const s = stmt.trim();
      // MariaDB's CREATE OR REPLACE drops the existing object and its data.
      return /^CREATE\s+OR\s+REPLACE\b/i.test(s) ? "CREATE OR REPLACE" : s.split(/\s+/)[0].toUpperCase();
    })
    .filter((verb) => verb === "CREATE OR REPLACE" || DESTRUCTIVE_VERBS.has(verb));
  return [...new Set(verbs)];
}

/** NULL / booleans / JSON printed the way the grid shows them. */
export function renderCellValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
