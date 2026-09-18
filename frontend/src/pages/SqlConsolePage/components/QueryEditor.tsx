/**
 * QueryEditor -- the SQL textarea, the Execute / Clear actions, a badge that
 * repeats the target database next to Execute, and the execution summary.
 */
import { useId, type KeyboardEvent, type RefObject } from "react";
import { CircleAlert, CircleCheck, Database, Play, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge, Button, Card, Textarea } from "../../../components/ui";
import type { SqlDatabaseTarget } from "../../../services/api";
import { databaseLabelKey } from "../hooks/useQueryExecution";
import type { QueryResult } from "../sqlTypes";
import styles from "../SqlConsolePage.module.css";

interface Props {
  textareaRef: RefObject<HTMLTextAreaElement>;
  query: string;
  onQueryChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  database: SqlDatabaseTarget;
  executing: boolean;
  onExecute: () => void;
  onClear: () => void;
  result: QueryResult | null;
}

export function QueryEditor({
  textareaRef,
  query,
  onQueryChange,
  onKeyDown,
  database,
  executing,
  onExecute,
  onClear,
  result,
}: Props) {
  const { t } = useTranslation();
  const hintId = useId();

  return (
    <Card
      title={t("sqlConsole.editor.title")}
      icon={Play}
      actions={
        <span className="u-text-sm u-muted" id={hintId}>
          {t("sqlConsole.editor.shortcut")} {t("sqlConsole.editor.tabHint")}
        </span>
      }
    >
      <Textarea
        ref={textareaRef}
        mono
        rows={8}
        className={styles.editor}
        value={query}
        aria-label={t("sqlConsole.editor.label")}
        aria-describedby={hintId}
        placeholder={t("sqlConsole.editor.placeholder")}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={onKeyDown}
      />

      <div className={`l-cluster ${styles.editorActions}`}>
        <Button
          variant="primary"
          icon={Play}
          loading={executing}
          loadingLabel={t("sqlConsole.editor.executing")}
          disabled={!query.trim()}
          onClick={onExecute}
        >
          {t("sqlConsole.editor.execute")}
        </Button>
        {/* The target is never off screen while a statement is being written. */}
        <Badge icon={Database}>{t(databaseLabelKey(database))}</Badge>
        <Button variant="ghost" icon={Trash2} onClick={onClear} title={t("sqlConsole.editor.clearTitle")}>
          {t("sqlConsole.editor.clear")}
        </Button>

        {result && (
          <span className={`${styles.summary} u-push u-text-sm`} data-tone={result.success ? "success" : "danger"}>
            {result.success ? (
              <CircleCheck size={16} strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <CircleAlert size={16} strokeWidth={1.75} aria-hidden="true" />
            )}
            {result.success
              ? t("sqlConsole.results.summarySuccess", {
                  message: result.message,
                  time: result.execution_time_ms.toFixed(1),
                })
              : t("sqlConsole.results.summaryFailure")}
          </span>
        )}
      </div>
    </Card>
  );
}
