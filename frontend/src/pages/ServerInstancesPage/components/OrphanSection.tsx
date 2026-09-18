/** Containers found on a host that have no ARKM_server_instances row yet. */
import { PackagePlus, Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Badge, Button, Card, StatusBadge } from "../../../components/ui";
import type { DiscoveredContainer } from "../../../types";
import styles from "../ServerInstancesPage.module.css";

interface Props {
  orphans: DiscoveredContainer[];
  machineName: (id: number) => string;
  /** Omitted for roles that cannot import: the button is then hidden. */
  onImport?: (container: DiscoveredContainer) => void;
}

export function OrphanSection({ orphans, machineName, onImport }: Props) {
  const { t } = useTranslation();

  return (
    <Card title={t("instances.orphansTitle", { count: orphans.length })} icon={Search}>
      <div className="l-stack l-stack--sm">
        <p className="u-secondary u-text-sm">{t("instances.orphansHint")}</p>
        {orphans.map(c => (
          <OrphanRow
            key={`${c.machine_id}-${c.name}`}
            container={c}
            machineLabel={machineName(c.machine_id)}
            onImport={onImport}
          />
        ))}
      </div>
    </Card>
  );
}

function OrphanRow({
  container,
  machineLabel,
  onImport,
}: {
  container: DiscoveredContainer;
  machineLabel: string;
  onImport?: (container: DiscoveredContainer) => void;
}) {
  const { t } = useTranslation();
  const name = container.server_name || container.name;

  return (
    <div className={styles.orphanRow}>
      <div className="l-stack l-stack--sm">
        <span className="l-cluster">
          <strong>{name}</strong>
          <Badge>{container.map_name || t("instances.mapUnknown")}</Badge>
          <StatusBadge
            status={container.process_running ? "online" : "offline"}
            label={
              container.status ||
              t(container.process_running ? "instances.status.running" : "instances.status.stopped")
            }
          />
        </span>
        <p className={styles.meta}>
          <span>{machineLabel}</span>
          <span aria-hidden="true">&middot;</span>
          <span className="u-mono">{container.name}</span>
          {container.path && (
            <>
              <span aria-hidden="true">&middot;</span>
              <code className="ui-code u-wrap-anywhere">{container.path}</code>
            </>
          )}
        </p>
        {container.plugins?.length > 0 && (
          <p className="u-muted u-text-sm">
            {t("instances.orphanPlugins", { plugins: container.plugins.join(", ") })}
          </p>
        )}
      </div>
      {onImport && (
        <Button
          size="sm"
          variant="primary"
          icon={PackagePlus}
          className="u-push"
          onClick={() => onImport(container)}
        >
          {t("instances.importButton")}
        </Button>
      )}
    </div>
  );
}
