/**
 * useInstanceActions -- lifecycle dispatch, the per-instance audit drawer and
 * the pending countdown of a scheduled native restart.
 *
 * Busy state is per instance (usePending), so a 30-minute update on one map
 * never freezes the controls of the other maps of a cluster.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { TFunction } from "i18next";

import type { ConfirmOptions, ToastApi } from "../../../components/ui";
import { usePending } from "../../../hooks/usePending";
import { serverInstancesApi } from "../../../services/api";
import { extractError } from "../../../utils/errors";
import type { InstanceAction, InstanceActionResult, ServerInstance } from "../../../types";
import type { LifecycleAction } from "../instanceModel";

/** A native countdown restart the panel is holding a timer for. */
export interface ScheduledRestart {
  instanceId: number;
  name: string;
  minutes: number;
}

interface Args {
  refreshOne: (id: number) => Promise<void>;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  toast: ToastApi;
  t: TFunction;
}

export function useInstanceActions({ refreshOne, confirm, toast, t }: Args) {
  const pending = usePending<number>();
  const [busyAction, setBusyAction] = useState<Record<number, LifecycleAction>>({});
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [actionLog, setActionLog] = useState<Record<number, InstanceAction[]>>({});
  const [scheduled, setScheduled] = useState<ScheduledRestart | null>(null);
  const [cancelling, setCancelling] = useState(false);

  // Read after an awaited action, when the closure's expandedId is stale.
  const expandedIdRef = useRef<number | null>(null);

  const loadActionLog = useCallback(async (id: number) => {
    try {
      const res = await serverInstancesApi.actions(id, { limit: 20 });
      setActionLog(prev => ({ ...prev, [id]: res.data }));
    } catch {
      // A failed periodic re-read keeps the rows already on screen.
      setActionLog(prev => (prev[id] ? prev : { ...prev, [id]: [] }));
    }
  }, []);

  // While a drawer is open, re-read its rows and the instance status: some
  // actions finish after their request returned (a native countdown restart
  // runs from a background task, another operator acts on the same instance).
  useEffect(() => {
    expandedIdRef.current = expandedId;
    if (expandedId === null) return;
    const id = expandedId;
    const timer = setInterval(() => {
      if (document.hidden) return;
      loadActionLog(id);
      refreshOne(id);
    }, 10_000);
    return () => clearInterval(timer);
  }, [expandedId, loadActionLog, refreshOne]);

  // The countdown banner disappears on its own once the restart has run.
  useEffect(() => {
    if (!scheduled) return;
    const timer = setTimeout(() => setScheduled(null), scheduled.minutes * 60_000);
    return () => clearTimeout(timer);
  }, [scheduled]);

  const showActionFeedback = useCallback(
    (result: InstanceActionResult) => {
      if (result.status === "success") {
        toast.success(t("instances.actionOk", { rc: result.exit_code, ms: result.duration_ms }));
      } else {
        toast.error(
          t("instances.actionFailed", {
            rc: result.exit_code,
            output: (result.stderr_tail || result.stdout_tail || t("instances.errors.action"))
              .split("\n")
              .slice(-5)
              .join(" | "),
          }),
        );
      }
    },
    [t, toast],
  );

  const runAction = useCallback(
    async (inst: ServerInstance, action: LifecycleAction) => {
      const id = inst.id;
      // usePending already ignores a duplicate key; bail early so the label of
      // the action actually running is not overwritten.
      if (pending.isPending(id)) return;
      setBusyAction(prev => ({ ...prev, [id]: action }));
      try {
        await pending.run(id, async () => {
          const call =
            action === "start" ? serverInstancesApi.start(id) :
            action === "stop" ? serverInstancesApi.stop(id) :
            action === "restart" ? serverInstancesApi.restart(id) :
            action === "update" ? serverInstancesApi.update_(id) :
            action === "backup" ? serverInstancesApi.backup(id) :
            // Native-Windows hosts only: builds the instance tree, junctions,
            // WinSW service and firewall rule. POK hosts reject it with 400.
            action === "provision" ? serverInstancesApi.provision(id) :
            serverInstancesApi.status(id);
          const res = await call;
          if ("scheduled" in res.data) {
            // Nothing ran yet: the panel is holding a timer. The announcements
            // and the restart write their own audit rows, which an open drawer
            // picks up on its periodic re-read.
            setScheduled({
              instanceId: id,
              name: inst.display_name || inst.name,
              minutes: res.data.minutes,
            });
          } else {
            showActionFeedback(res.data);
          }
          await refreshOne(id);
          if (expandedIdRef.current === id) await loadActionLog(id);
        });
      } catch (e) {
        // AxiosError is an Error too: read the backend detail (409 on shared
        // installs or port clashes) instead of "Request failed with status".
        const detail = extractError(e, t("instances.errors.action"));
        const status = (e as { response?: { status?: number } })?.response?.status;
        // servers.py now rejects rows saved before the double-quote check.
        toast.error(
          action === "provision" && status === 422
            ? t("instances.errors.provisionInvalid", { detail })
            : detail,
        );
      } finally {
        setBusyAction(prev => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    },
    [loadActionLog, pending, refreshOne, showActionFeedback, t, toast],
  );

  /** Stop, Restart and Update take a live server down: each asks first. */
  const confirmAndRun = useCallback(
    async (inst: ServerInstance, action: "stop" | "restart" | "update") => {
      const name = inst.display_name || inst.name;
      const ok = await confirm({
        title: t(`instances.confirm.${action}Title`, { name }),
        description: t(`instances.confirm.${action}Body`, { name }),
        confirmLabel: t(`instances.actions.${action}`),
        tone: "danger",
      });
      if (!ok) return;
      await runAction(inst, action);
    },
    [confirm, runAction, t],
  );

  const cancelScheduled = useCallback(async () => {
    if (!scheduled) return;
    setCancelling(true);
    try {
      const res = await serverInstancesApi.cancelRestart(scheduled.instanceId);
      toast.success(res.data.cancelled ? t("instances.restartCancelled", { name: scheduled.name }) : res.data.detail);
      setScheduled(null);
      await refreshOne(scheduled.instanceId);
    } catch (e) {
      toast.error(extractError(e, t("instances.errors.cancelRestart")));
    } finally {
      setCancelling(false);
    }
  }, [refreshOne, scheduled, t, toast]);

  const toggleExpanded = useCallback(
    async (id: number) => {
      if (expandedId === id) {
        setExpandedId(null);
        return;
      }
      setExpandedId(id);
      // Always re-read: actions run while the drawer was closed are not in the
      // cached rows, which stay on screen until the new ones arrive.
      await loadActionLog(id);
    },
    [expandedId, loadActionLog],
  );

  return {
    isBusy: pending.isPending,
    busyAction,
    expandedId,
    setExpandedId,
    actionLog,
    scheduled,
    cancelling,
    cancelScheduled,
    runAction,
    confirmAndRun,
    toggleExpanded,
  };
}
