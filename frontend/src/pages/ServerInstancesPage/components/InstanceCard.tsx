/** One registered instance: identity, lifecycle toolbar and the audit drawer. */
import { useId } from "react";
import {
  Activity,
  Archive,
  ChevronDown,
  DownloadCloud,
  Pencil,
  Play,
  RotateCw,
  Square,
  Trash2,
  Wrench,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { Badge, Card, IconButton, StatusBadge } from "../../../components/ui";
import type { InstanceAction, ServerInstance } from "../../../types";
import { actionLogTone, instanceRuntimeStatus, type CardAction } from "../instanceModel";
import styles from "../ServerInstancesPage.module.css";

interface Props {
  inst: ServerInstance;
  /** True while any action of THIS instance is running. */
  busy: boolean;
  /** Which action is running, for the spinner on the right button. */
  busyAction?: string;
  isAdmin: boolean;
  canOperate: boolean;
  expanded: boolean;
  actions: InstanceAction[] | undefined;
  machineLabel: string;
  onToggle: () => void;
  onAction: (action: CardAction) => void;
  onUpdate: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function InstanceCard({
  inst,
  busy,
  busyAction,
  isAdmin,
  canOperate,
  expanded,
  actions,
  machineLabel,
  onToggle,
  onAction,
  onUpdate,
  onEdit,
  onDelete,
}: Props) {
  const { t } = useTranslation();
  const drawerId = useId();
  const name = inst.display_name || inst.name;
  const on = (action: string) => t("instances.actionOn", { action, name });
  const btn = (action: CardAction) => ({
    loading: busy && busyAction === action,
    disabled: busy && busyAction !== action,
  });

  return (
    <Card
      titleAs="h3"
      title={
        <span className="l-cluster">
          <span>{name}</span>
          <Badge>{inst.map_name}</Badge>
          {inst.cluster_id && <Badge>{t("instances.clusterTag", { id: inst.cluster_id })}</Badge>}
          {!inst.is_active && <Badge tone="warning">{t("instances.inactiveTag")}</Badge>}
        </span>
      }
      actions={
        <>
          <StatusBadge
            status={instanceRuntimeStatus(inst.status)}
            label={t(`instances.status.${inst.status}`)}
          />
          <IconButton
            size="sm"
            icon={ChevronDown}
            label={t("instances.log.toggle", { name })}
            aria-expanded={expanded}
            aria-controls={expanded ? drawerId : undefined}
            onClick={onToggle}
          />
        </>
      }
    >
      <div className="l-stack l-stack--sm">
        <p className={styles.meta}>
          <span>{machineLabel}</span>
          <span aria-hidden="true">&middot;</span>
          <span className="u-mono">{inst.container_name || inst.service_name || inst.name}</span>
          <span aria-hidden="true">&middot;</span>
          <span className="u-mono u-num">
            {inst.game_port}/{inst.rcon_port}
          </span>
        </p>
        {inst.description && <p className="u-muted u-text-sm">{inst.description}</p>}

        {/* Every call below needs an operator; delete needs an admin. */}
        {canOperate && (
          <div className={styles.toolbar}>
            <IconButton
              icon={Play}
              label={on(t("instances.actions.start"))}
              {...btn("start")}
              onClick={() => onAction("start")}
            />
            <IconButton
              icon={Square}
              tone="danger"
              label={on(t("instances.actions.stop"))}
              {...btn("stop")}
              onClick={() => onAction("stop")}
            />
            <IconButton
              icon={RotateCw}
              label={on(t("instances.actions.restart"))}
              {...btn("restart")}
              onClick={() => onAction("restart")}
            />
            <IconButton
              icon={Activity}
              label={on(t("instances.actions.probe"))}
              {...btn("probe")}
              onClick={() => onAction("probe")}
            />
            <IconButton
              icon={Archive}
              label={on(t("instances.actions.backup"))}
              {...btn("backup")}
              onClick={() => onAction("backup")}
            />
            <IconButton
              icon={DownloadCloud}
              label={on(t("instances.actions.update"))}
              loading={busy && busyAction === "update"}
              disabled={busy && busyAction !== "update"}
              onClick={onUpdate}
            />
            {/* Native instances only. service_name is NULL on every POK row, so
                it doubles as the runtime marker without another round trip. */}
            {inst.service_name && (
              <IconButton
                icon={Wrench}
                label={on(t("instances.actions.provision"))}
                {...btn("provision")}
                onClick={() => onAction("provision")}
              />
            )}
            <IconButton
              icon={Pencil}
              label={on(t("instances.actions.edit"))}
              onClick={onEdit}
            />
            {isAdmin && (
              <IconButton
                className="u-push"
                icon={Trash2}
                tone="danger"
                label={on(t("instances.actions.delete"))}
                onClick={onDelete}
              />
            )}
          </div>
        )}

        {expanded && (
          <section id={drawerId} className="l-stack l-stack--sm" aria-live="polite">
            <h4 className={styles.drawerTitle}>{t("instances.log.title", { name })}</h4>
            {!actions ? (
              <p className="u-muted u-text-sm">{t("common.loading")}</p>
            ) : actions.length === 0 ? (
              <p className="u-muted u-text-sm">{t("instances.log.empty")}</p>
            ) : (
              actions.map(a => (
                <details key={a.id} className="ui-details">
                  <summary>
                    <span className={styles.logSummary}>
                      <span className="u-mono">{a.action}</span>
                      <Badge tone={actionLogTone(a.status)}>
                        {t(`instances.log.status.${a.status}`, { defaultValue: a.status })}
                      </Badge>
                      <span className="u-muted u-text-sm u-num">
                        {t("instances.log.exitCode", { rc: a.exit_code ?? "--" })}
                      </span>
                      <span className="u-muted u-text-sm u-num">
                        {t("instances.log.duration", { ms: a.duration_ms ?? "--" })}
                      </span>
                      {a.started_at && (
                        <span className="u-muted u-text-sm u-mono">{a.started_at}</span>
                      )}
                      {a.username && <span className="u-muted u-text-sm">@{a.username}</span>}
                    </span>
                  </summary>
                  <div className="ui-details__body">
                    <pre className="ui-log" role="log" tabIndex={0}>
                      {a.stdout || a.stderr || t("instances.log.noStdout")}
                    </pre>
                  </div>
                </details>
              ))
            )}
          </section>
        )}
      </div>
    </Card>
  );
}
