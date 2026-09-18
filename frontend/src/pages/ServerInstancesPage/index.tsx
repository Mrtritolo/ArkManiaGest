/**
 * ServerInstancesPage -- unified ARK server management.
 *
 *   - Lists every ``ARKM_server_instances`` row registered in the panel DB.
 *   - Scans the SSH machines for ARK containers that are NOT in the DB
 *     (orphans) and imports them as managed instances.
 *   - Runs the lifecycle actions (start / stop / restart / update / backup /
 *     probe / provision) and shows the per-instance audit log.
 *
 * Role gating mirrors servers.py / containers.py: every write and every
 * lifecycle call needs an operator, delete needs an admin, viewers read.
 */
import { useEffect, useState } from "react";
import { RotateCw, Server } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  Alert,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Modal,
  Spinner,
  useConfirm,
  useToast,
} from "../../components/ui";
import type { AuthUser, ServerInstance } from "../../types";
import { ImportContainerCard } from "./components/ImportContainerCard";
import { InstanceCard } from "./components/InstanceCard";
import { InstanceFormCard } from "./components/InstanceFormCard";
import { InstancesHeader } from "./components/InstancesHeader";
import { OrphanSection } from "./components/OrphanSection";
import { useInstanceActions } from "./hooks/useInstanceActions";
import { useInstanceForm } from "./hooks/useInstanceForm";
import { useInstancesData } from "./hooks/useInstancesData";
import { useOrphanImport } from "./hooks/useOrphanImport";
import type { CardAction } from "./instanceModel";

interface Props {
  /** Passed in from App.tsx so write controls are gated by role. */
  currentUser?: AuthUser | null;
}

export default function ServerInstancesPage({ currentUser }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();

  const isAdmin = currentUser?.role === "admin";
  const canOperate = isAdmin || currentUser?.role === "operator";

  // null = loaded; a string (possibly empty) = the last load failed.
  const [loadError, setLoadError] = useState<string | null>(null);

  const data = useInstancesData({ setLoadError });
  const actions = useInstanceActions({ refreshOne: data.refreshOne, confirm, toast, t });
  const form = useInstanceForm({
    machines: data.machines,
    loadInstances: data.loadInstances,
    toast,
    t,
  });
  const orphanImport = useOrphanImport({
    machines: data.machines,
    loadDiscoveredCache: data.loadDiscoveredCache,
    loadInstances: data.loadInstances,
    toast,
    t,
  });

  const { expandedId, setExpandedId } = actions;
  const { instances, filterMachineId } = data;

  // Close the drawer once its card is gone (deleted, or hidden by the machine
  // filter): the card can no longer be clicked, so its poll would keep running.
  useEffect(() => {
    if (expandedId === null) return;
    const visible = instances.some(
      i => i.id === expandedId && (filterMachineId === "all" || i.machine_id === filterMachineId),
    );
    if (!visible) setExpandedId(null);
  }, [expandedId, instances, filterMachineId, setExpandedId]);

  const editingInstance =
    form.editingId === null ? undefined : instances.find(i => i.id === form.editingId);

  function dispatchCardAction(inst: ServerInstance, action: CardAction) {
    // Stop and Restart take a live game server down: both ask first.
    if (action === "stop" || action === "restart") {
      void actions.confirmAndRun(inst, action);
      return;
    }
    void actions.runAction(inst, action);
  }

  const firstLoad = !data.loaded;
  const scheduled = actions.scheduled;

  return (
    <div className="l-page">
      <InstancesHeader
        count={data.filteredInstances.length}
        machines={data.machines}
        filterMachineId={data.filterMachineId}
        onFilterChange={data.setFilterMachineId}
        canOperate={canOperate}
        scanning={orphanImport.scanning}
        onScanAll={orphanImport.handleScanAll}
        onCreate={form.openCreate}
      />

      {loadError !== null && (
        <Alert
          tone="danger"
          title={t("instances.errors.load")}
          actions={
            <Button size="sm" icon={RotateCw} onClick={() => void data.loadInstances()}>
              {t("common.retry")}
            </Button>
          }
        >
          {loadError || undefined}
        </Alert>
      )}

      {orphanImport.scanFailures.length > 0 && (
        <Alert
          tone="danger"
          title={t("instances.scanFailed", { count: orphanImport.scanFailures.length })}
          onDismiss={orphanImport.dismissScanFailures}
        >
          <ul className="l-stack l-stack--sm">
            {orphanImport.scanFailures.map(line => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Alert>
      )}

      {scheduled && (
        <Alert
          tone="warning"
          title={t("instances.restartScheduledTitle", { name: scheduled.name })}
          actions={
            <Button
              size="sm"
              loading={actions.cancelling}
              loadingLabel={t("instances.cancellingRestart")}
              onClick={() => void actions.cancelScheduled()}
            >
              {t("instances.cancelRestart")}
            </Button>
          }
        >
          {t("instances.restartScheduled", { count: scheduled.minutes })}
        </Alert>
      )}

      {canOperate && form.showForm && (
        <InstanceFormCard
          editingId={form.editingId}
          editingInstance={editingInstance}
          form={form.form}
          setField={form.setField}
          machines={data.machines}
          saving={form.saving}
          formError={form.formError}
          invalidFields={form.invalidFields}
          clearServerPassword={form.clearServerPassword}
          setClearServerPassword={form.setClearServerPassword}
          cardRef={form.formRef}
          firstFieldRef={form.firstFieldRef}
          onSubmit={form.submitForm}
          onCancel={form.closeForm}
        />
      )}

      {/* Rows stay on screen while a refetch runs; only the first load blanks. */}
      {data.refreshing && !firstLoad && <Spinner label={t("instances.refreshing")} />}

      {firstLoad ? (
        <Card>
          <Spinner block label={t("instances.loading")} />
        </Card>
      ) : data.filteredInstances.length === 0 ? (
        <Card>
          <EmptyState
            icon={Server}
            title={t("instances.empty.title")}
            description={t("instances.noInstances")}
          />
        </Card>
      ) : (
        <div className="l-stack">
          {data.filteredInstances.map(inst => (
            <InstanceCard
              key={inst.id}
              inst={inst}
              busy={actions.isBusy(inst.id)}
              busyAction={actions.busyAction[inst.id]}
              isAdmin={isAdmin}
              canOperate={canOperate}
              expanded={expandedId === inst.id}
              actions={actions.actionLog[inst.id]}
              machineLabel={data.machineName(inst.machine_id)}
              onToggle={() => void actions.toggleExpanded(inst.id)}
              onAction={a => dispatchCardAction(inst, a)}
              onUpdate={() => void actions.confirmAndRun(inst, "update")}
              onEdit={() => form.openEdit(inst)}
              onDelete={() => form.openDelete(inst)}
            />
          ))}
        </div>
      )}

      {data.orphans.length > 0 && (
        <OrphanSection
          orphans={data.orphans}
          machineName={data.machineName}
          onImport={canOperate ? orphanImport.openImport : undefined}
        />
      )}

      {canOperate && orphanImport.importingFor && orphanImport.importForm && (
        <ImportContainerCard
          container={orphanImport.importingFor}
          machineLabel={data.machineName(orphanImport.importingFor.machine_id)}
          form={orphanImport.importForm}
          setForm={orphanImport.setImportForm}
          importing={orphanImport.importing}
          importError={orphanImport.importError}
          onSubmit={orphanImport.submitImport}
          onCancel={orphanImport.closeImport}
        />
      )}

      {form.deleteTarget && (
        <Modal
          open
          size="sm"
          dismissible={!form.deleting}
          title={t("instances.delete.title", { name: form.deleteTarget.name })}
          description={t("instances.confirmDelete", { name: form.deleteTarget.name })}
          onClose={form.closeDelete}
          footer={
            <>
              <Button variant="secondary" onClick={form.closeDelete}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="danger"
                loading={form.deleting}
                loadingLabel={t("instances.delete.deleting")}
                onClick={() => void form.confirmDelete()}
              >
                {t("instances.delete.confirm")}
              </Button>
            </>
          }
        >
          <div className="l-stack l-stack--sm">
            {form.deleteError && <Alert tone="danger">{form.deleteError}</Alert>}
            <Checkbox
              label={t("instances.delete.purge")}
              description={t("instances.delete.purgeHint")}
              checked={form.purgeOnHost}
              onChange={e => form.setPurgeOnHost(e.target.checked)}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
