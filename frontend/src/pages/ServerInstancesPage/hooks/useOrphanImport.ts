/**
 * useOrphanImport -- the sequential machine scan and the inline form that
 * promotes a discovered container into a managed instance.
 *
 * The scan walks the machines one at a time (an SSH round trip each) and
 * reports which ones failed instead of claiming every host was scanned.
 */
import { useCallback, useState, type FormEvent } from "react";
import type { TFunction } from "i18next";

import type { ToastApi } from "../../../components/ui";
import { containersApi, serverInstancesApi } from "../../../services/api";
import { extractError } from "../../../utils/errors";
import type { DiscoveredContainer, SSHMachine } from "../../../types";
import { emptyImportForm, type ImportFormState } from "../instanceModel";

interface Args {
  machines: SSHMachine[];
  loadDiscoveredCache: () => Promise<void>;
  loadInstances: () => Promise<void>;
  toast: ToastApi;
  t: TFunction;
}

export function useOrphanImport({ machines, loadDiscoveredCache, loadInstances, toast, t }: Args) {
  const [scanningMachineId, setScanningMachineId] = useState<number | null>(null);
  const [scanFailures, setScanFailures] = useState<string[]>([]);
  const [importingFor, setImportingFor] = useState<DiscoveredContainer | null>(null);
  const [importForm, setImportForm] = useState<ImportFormState | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");

  const handleScanAll = useCallback(async () => {
    if (machines.length === 0) return;
    setScanFailures([]);
    const failures: string[] = [];
    for (const m of machines) {
      setScanningMachineId(m.id);
      try {
        await containersApi.scanMachine(m.id);
      } catch (e) {
        // A host that is down must not be reported as "scanned, 0 found".
        failures.push(`${m.name}: ${extractError(e, t("instances.errors.scan"))}`);
      }
    }
    setScanningMachineId(null);
    await loadDiscoveredCache();
    setScanFailures(failures);
    const ok = machines.length - failures.length;
    if (ok > 0) toast.success(t("instances.scanDone", { count: ok }));
    if (failures.length > 0) toast.error(t("instances.scanFailed", { count: failures.length }));
  }, [loadDiscoveredCache, machines, t, toast]);

  const openImport = useCallback((c: DiscoveredContainer) => {
    setImportingFor(c);
    setImportForm(emptyImportForm(c));
    setImportError("");
  }, []);

  const closeImport = useCallback(() => {
    setImportingFor(null);
    setImportForm(null);
    setImportError("");
  }, []);

  const submitImport = useCallback(
    async (evt: FormEvent) => {
      evt.preventDefault();
      if (!importingFor || !importForm) return;
      setImporting(true);
      setImportError("");
      try {
        await serverInstancesApi.importFromContainer({
          machine_id: importingFor.machine_id,
          container_name: importingFor.name,
          admin_password: importForm.admin_password,
          server_password: importForm.server_password || undefined,
          display_name: importForm.display_name,
          map_name: importForm.map_name,
          game_port: importForm.game_port,
          rcon_port: importForm.rcon_port,
        });
        toast.success(t("instances.importDone", { name: importingFor.name }));
        closeImport();
        await loadInstances();
      } catch (e) {
        setImportError(extractError(e, t("instances.errors.import")));
      } finally {
        setImporting(false);
      }
    },
    [closeImport, importForm, importingFor, loadInstances, t, toast],
  );

  return {
    scanningMachineId,
    scanning: scanningMachineId !== null,
    scanFailures,
    handleScanAll,
    dismissScanFailures: useCallback(() => setScanFailures([]), []),
    importingFor,
    importForm,
    setImportForm,
    importing,
    importError,
    openImport,
    closeImport,
    submitImport,
  };
}
