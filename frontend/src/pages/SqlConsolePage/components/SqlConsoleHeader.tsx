/**
 * SqlConsoleHeader -- page title, the panel/plugin target switch and the two
 * side-panel toggles.
 */
import { Clock, Database, Table2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, PageHeader, SegmentedControl } from "../../../components/ui";
import type { SqlDatabaseTarget } from "../../../services/api";

interface Props {
  database: SqlDatabaseTarget;
  onDatabaseChange: (database: SqlDatabaseTarget) => void;
  browserOpen: boolean;
  onToggleBrowser: () => void;
  historyOpen: boolean;
  onToggleHistory: () => void;
  historyCount: number;
}

export function SqlConsoleHeader({
  database,
  onDatabaseChange,
  browserOpen,
  onToggleBrowser,
  historyOpen,
  onToggleHistory,
  historyCount,
}: Props) {
  const { t } = useTranslation();

  return (
    <PageHeader
      title={t("sqlConsole.heading")}
      icon={Database}
      description={t("sqlConsole.subtitle")}
      actions={
        <>
          <SegmentedControl
            size="sm"
            label={t("sqlConsole.db.legend")}
            value={database}
            onChange={onDatabaseChange}
            options={[
              { value: "panel", label: t("sqlConsole.db.panel") },
              { value: "plugin", label: t("sqlConsole.db.plugin") },
            ]}
          />
          <Button
            size="sm"
            icon={Table2}
            pressed={browserOpen}
            aria-expanded={browserOpen}
            aria-controls="sql-table-browser"
            onClick={onToggleBrowser}
            title={t("sqlConsole.toggle.tablesTitle")}
          >
            {t("sqlConsole.toggle.tables")}
          </Button>
          <Button
            size="sm"
            icon={Clock}
            pressed={historyOpen}
            aria-expanded={historyOpen}
            aria-controls="sql-query-history"
            onClick={onToggleHistory}
            title={t("sqlConsole.toggle.historyTitle")}
          >
            {t("sqlConsole.toggle.history", { count: historyCount })}
          </Button>
        </>
      }
    />
  );
}
