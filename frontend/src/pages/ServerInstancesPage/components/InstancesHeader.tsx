/** Page title, instance count, machine filter and the two operator actions. */
import { Plus, RefreshCw, Server } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button, PageHeader, Select } from "../../../components/ui";
import type { SSHMachine } from "../../../types";

interface Props {
  count: number;
  machines: SSHMachine[];
  filterMachineId: number | "all";
  onFilterChange: (value: number | "all") => void;
  /** Operator or above: every action below is refused for a viewer. */
  canOperate: boolean;
  scanning: boolean;
  onScanAll: () => void;
  onCreate: () => void;
}

export function InstancesHeader({
  count,
  machines,
  filterMachineId,
  onFilterChange,
  canOperate,
  scanning,
  onScanAll,
  onCreate,
}: Props) {
  const { t } = useTranslation();
  const noMachines = machines.length === 0;

  return (
    <PageHeader
      title={t("instances.title")}
      icon={Server}
      description={
        <>
          {t("instances.subtitle")}
          {count > 0 && <> {t("instances.subtitleCount", { count })}</>}
        </>
      }
      actions={
        <>
          <Select
            size="sm"
            aria-label={t("instances.filterMachine")}
            value={filterMachineId}
            onChange={e => onFilterChange(e.target.value === "all" ? "all" : Number(e.target.value))}
          >
            <option value="all">{t("instances.filterAll")}</option>
            {machines.map(m => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
          {canOperate && (
            <>
              <Button
                icon={RefreshCw}
                loading={scanning}
                loadingLabel={t("instances.scanning")}
                disabled={noMachines}
                title={noMachines ? t("instances.noMachinesHint") : undefined}
                onClick={onScanAll}
              >
                {t("instances.scanAll")}
              </Button>
              <Button
                variant="primary"
                icon={Plus}
                disabled={noMachines}
                title={noMachines ? t("instances.noMachinesHint") : undefined}
                onClick={onCreate}
              >
                {t("instances.newButton")}
              </Button>
            </>
          )}
        </>
      }
    />
  );
}
