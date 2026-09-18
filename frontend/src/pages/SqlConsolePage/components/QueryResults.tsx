/**
 * QueryResults -- the error box, the row grid (sticky header, own scroll
 * container) and the "no columns" line of a DML statement.
 */
import { CircleCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, Card, Table } from "../../../components/ui";
import { MAX_RENDER_ROWS, renderCellValue, type QueryResult } from "../sqlTypes";
import styles from "../SqlConsolePage.module.css";

interface Props {
  result: QueryResult;
}

export function QueryResults({ result }: Props) {
  const { t } = useTranslation();
  const rows = result.rows.slice(0, MAX_RENDER_ROWS);
  const capped = result.truncated || result.rows.length > MAX_RENDER_ROWS;

  return (
    <Card title={t("sqlConsole.results.title")}>
      {result.error && (
        <Alert tone="danger" title={t("sqlConsole.results.errorTitle")}>
          <pre className={`ui-code ${styles.errorText}`}>{result.error}</pre>
        </Alert>
      )}

      {result.success && capped && (
        <Alert tone="warning" className={styles.capNotice}>
          {t("sqlConsole.results.truncated", { n: rows.length })}
        </Alert>
      )}

      {result.success && result.columns.length > 0 && (
        <Table label={t("sqlConsole.results.title")} maxHeight="60vh">
          <thead>
            <tr>
              <th scope="col" className="u-text-end">
                <span className="u-sr-only">{t("sqlConsole.results.rowNumber")}</span>
                <span aria-hidden="true">#</span>
              </th>
              {result.columns.map((col) => (
                <th scope="col" key={col} className="u-mono">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIdx) => (
              <tr key={rowIdx}>
                <td className="u-num u-text-end u-muted">{rowIdx + 1}</td>
                {row.map((cell, colIdx) => {
                  const text = renderCellValue(cell);
                  return (
                    <td
                      key={colIdx}
                      className={`u-mono u-num ${styles.cell}`}
                      data-null={cell === null || undefined}
                      title={text}
                    >
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {result.success && result.columns.length === 0 && (
        <p className={styles.dmlLine}>
          <CircleCheck size={16} strokeWidth={1.75} aria-hidden="true" />
          {t("sqlConsole.results.dmlSuccess", {
            message: result.message,
            time: result.execution_time_ms.toFixed(1),
          })}
        </p>
      )}
    </Card>
  );
}
