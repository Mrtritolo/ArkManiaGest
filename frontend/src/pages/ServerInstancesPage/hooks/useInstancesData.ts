/**
 * useInstancesData -- the three lists the page renders (instances, machines,
 * discovered containers), the machine filter and the derived orphan set.
 *
 * Rows stay on screen while a refetch runs; only the very first load blanks
 * the list. A request counter drops a response that a newer request has
 * already superseded (switching the machine filter twice quickly).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { containersApi, machinesApi, serverInstancesApi } from "../../../services/api";
import { extractError } from "../../../utils/errors";
import type { DiscoveredContainer, ServerInstance, SSHMachine } from "../../../types";

interface Args {
  /** null clears the banner; a string (possibly empty) marks a failed load. */
  setLoadError: (message: string | null) => void;
}

export function useInstancesData({ setLoadError }: Args) {
  const [instances, setInstances] = useState<ServerInstance[]>([]);
  const [machines, setMachines] = useState<SSHMachine[]>([]);
  const [discovered, setDiscovered] = useState<DiscoveredContainer[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [filterMachineId, setFilterMachineId] = useState<number | "all">("all");

  // Only the newest list request may write the rows.
  const requestId = useRef(0);

  const loadInstances = useCallback(async () => {
    const mine = ++requestId.current;
    setRefreshing(true);
    setLoadError(null);
    try {
      const params = filterMachineId === "all" ? undefined : { machine_id: filterMachineId };
      const res = await serverInstancesApi.list(params);
      if (mine !== requestId.current) return;
      setInstances(res.data);
    } catch (e) {
      if (mine !== requestId.current) return;
      setLoadError(extractError(e, ""));
    } finally {
      if (mine === requestId.current) {
        setRefreshing(false);
        setLoaded(true);
      }
    }
  }, [filterMachineId, setLoadError]);

  const loadMachines = useCallback(async () => {
    try {
      const r = await machinesApi.list(true);
      setMachines(r.data);
    } catch {
      /* non-fatal: the filter and the create form simply stay empty */
    }
  }, []);

  // Cached scan results, so orphan rows render without pressing "Scan" first.
  const loadDiscoveredCache = useCallback(async () => {
    try {
      const res = await containersApi.getAllContainers();
      // The endpoint returns `{ containers: [...], last_scan: ... }`.
      const list = (res.data as { containers?: DiscoveredContainer[] })?.containers ?? [];
      setDiscovered(list);
    } catch {
      setDiscovered([]);
    }
  }, []);

  useEffect(() => {
    loadMachines();
    loadDiscoveredCache();
  }, [loadMachines, loadDiscoveredCache]);

  // loadInstances depends on filterMachineId, so this also refetches on filter
  // changes; filteredInstances still filters on the client for the gap between.
  useEffect(() => {
    loadInstances();
  }, [loadInstances]);

  const machineById = useMemo(
    () => Object.fromEntries(machines.map(m => [m.id, m])),
    [machines],
  );
  const machineName = useCallback(
    (id: number) => machineById[id]?.name ?? `#${id}`,
    [machineById],
  );

  /** A scanned container with no ARKM_server_instances row on the same machine. */
  const orphans = useMemo(() => {
    const known = new Set(instances.map(i => `${i.machine_id}:${i.container_name}`));
    return discovered.filter(c => {
      if (filterMachineId !== "all" && c.machine_id !== filterMachineId) return false;
      return !known.has(`${c.machine_id}:${c.name}`);
    });
  }, [discovered, instances, filterMachineId]);

  const filteredInstances = useMemo(
    () =>
      filterMachineId === "all"
        ? instances
        : instances.filter(i => i.machine_id === filterMachineId),
    [instances, filterMachineId],
  );

  const refreshOne = useCallback(async (id: number) => {
    try {
      const res = await serverInstancesApi.get(id);
      setInstances(prev => prev.map(i => (i.id === id ? res.data : i)));
    } catch {
      /* a failed single refresh keeps the row already on screen */
    }
  }, []);

  return {
    instances,
    machines,
    filteredInstances,
    orphans,
    loaded,
    refreshing,
    filterMachineId,
    setFilterMachineId,
    loadInstances,
    loadDiscoveredCache,
    machineName,
    refreshOne,
  };
}
