/**
 * QueryHistory -- the statements run in this session (never persisted).
 * Replaying one restores the statement AND the database it ran against.
 */
import { CircleAlert, CircleCheck, Clock, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, EmptyState, IconButton } from "../../../components/ui";
import { databaseLabelKey } from "../hooks/useQueryExecution";
import type { HistoryEntry } from "../sqlTypes";
import styles from "../SqlConsolePage.module.css";

interface Props {
  history: HistoryEntry[];
  onClear: () => void;
  onReplay: (entry: HistoryEntry) => void;
}

export function QueryHistory({ history, onClear, onReplay }: Props) {
  const { t } = useTranslation();

  return (
    <Card
      title={t("sqlConsole.history.title")}
      titleAs="h3"
      icon={Clock}
      className={styles.sidePanel}
      actions={
        history.length > 0 ? (
          <IconButton
            size="sm"
            icon={Trash2}
            label={t("sqlConsole.history.clearTitle")}
            onClick={onClear}
          />
        ) : undefined
      }
    >
      {history.length === 0 ? (
        <EmptyState icon={Clock} title={t("sqlConsole.history.empty")} />
      ) : (
        <ul className={styles.historyList}>
          {history.map((entry, idx) => (
            <li key={idx}>
              <button
                type="button"
                className={styles.historyEntry}
                title={t("sqlConsole.history.loadTitle")}
                onClick={() => onReplay(entry)}
              >
                <span className={`u-mono u-truncate ${styles.historyQuery}`}>{entry.query}</span>
                <span className={styles.historyMeta} data-tone={entry.success ? "success" : "danger"}>
                  {entry.success ? (
                    <CircleCheck size={16} strokeWidth={1.75} aria-hidden="true" />
                  ) : (
                    <CircleAlert size={16} strokeWidth={1.75} aria-hidden="true" />
                  )}
                  <span className="u-truncate">{entry.message}</span>
                  <span className="u-muted u-push u-num">
                    {t("sqlConsole.history.ms", { n: entry.execution_time_ms.toFixed(0) })}
                  </span>
                </span>
                <span className="u-muted u-text-sm">
                  {t(databaseLabelKey(entry.database))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
