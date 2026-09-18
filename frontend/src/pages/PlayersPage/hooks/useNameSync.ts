/**
 * useNameSync — the .arkprofile / .arktribe scanners and the two follow-up
 * flows they can open.
 *
 *  * `ambiguous`: one EOS produced several distinct names across the cluster
 *    (multi-character). The admin picks one per row.
 *  * `not_matched`: an EOS exists on disk but has no `Players` row. A banner
 *    offers a bulk import; the filename (32 hex chars) is the EOS, because the
 *    binary parser often reports a null eos_id for orphan profiles.
 */
import { useState } from "react";
import type { TFunction } from "i18next";
import { playersApi, type SyncNamesAmbiguousEntry, type SyncNamesResponse } from "../../../services/api";
import { extractError } from "../../../utils/errors";
import type { ToastApi } from "../../../components/ui";

export interface OrphanProfile {
  eos_id: string;
  player_name: string;
  source: string;
}

interface Args {
  toast: ToastApi;
  loadPlayers: (s?: string, g?: string) => void;
  loadStats: () => void;
  t: TFunction;
}

export function useNameSync({ toast, loadPlayers, loadStats, t }: Args) {
  const [syncing, setSyncing] = useState(false);
  const [syncingTribes, setSyncingTribes] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncNamesResponse | null>(null);
  const [showSyncPanel, setShowSyncPanel] = useState(false);

  const [ambiguousList, setAmbiguousList] = useState<SyncNamesAmbiguousEntry[] | null>(null);
  const [chosenNames, setChosenNames] = useState<Record<number, string>>({});
  const [applyingAmbig, setApplyingAmbig] = useState(false);

  const [notMatchedList, setNotMatchedList] = useState<OrphanProfile[]>([]);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importChecked, setImportChecked] = useState<Record<string, boolean>>({});
  const [importing, setImporting] = useState(false);

  async function handleSyncNames(machineId?: number, containerName?: string) {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await playersApi.syncNames(machineId, containerName);
      setSyncResult(res.data);
      if (res.data.updated > 0) {
        loadPlayers();
        loadStats();
      }
      if (res.data.errors?.length > 0) {
        toast.error(t("players.messages.syncErrors", { errors: res.data.errors.join("; ") }));
      }
      // Multi-character cases: hand them to the picker modal, pre-selecting
      // the first candidate of each row so Apply-without-touching is sane.
      if (res.data.ambiguous && res.data.ambiguous.length > 0) {
        setAmbiguousList(res.data.ambiguous);
        const initial: Record<number, string> = {};
        for (const row of res.data.ambiguous) {
          initial[row.player_id] = row.candidates[0]?.name ?? "";
        }
        setChosenNames(initial);
      }
      if (res.data.not_matched && res.data.not_matched.length > 0) {
        const orphans = res.data.not_matched
          .map(n => ({
            eos_id: n.file_id, // filename = EOS
            player_name: n.player_name || "",
            source: n.source,
          }))
          // Drop entries whose filename is not EOS-shaped (32 hex chars).
          .filter(n => /^[0-9a-f]{32}$/i.test(n.eos_id));
        setNotMatchedList(orphans);
        const checks: Record<string, boolean> = {};
        for (const o of orphans) checks[o.eos_id] = true;
        setImportChecked(checks);
      }
    } catch (err) {
      toast.error(extractError(err, t("players.errors.syncNames")));
    } finally {
      setSyncing(false);
    }
  }

  function closeAmbiguous() {
    if (applyingAmbig) return;
    setAmbiguousList(null);
    setChosenNames({});
  }

  async function applyAmbiguousResolutions(): Promise<void> {
    if (!ambiguousList) return;
    const resolutions = Object.entries(chosenNames)
      .filter(([, name]) => Boolean(name && name.trim()))
      .map(([pid, name]) => ({ player_id: Number(pid), chosen_name: name }));
    if (resolutions.length === 0) {
      setAmbiguousList(null);
      setChosenNames({});
      return;
    }
    setApplyingAmbig(true);
    try {
      const res = await playersApi.resolveAmbiguousNames(resolutions);
      toast.success(t("players.ambiguous.applied", { n: res.data.applied }));
      setAmbiguousList(null);
      setChosenNames({});
      if (res.data.applied > 0) {
        loadPlayers();
        loadStats();
      }
    } catch (err) {
      toast.error(extractError(err, t("players.ambiguous.errors.apply")));
    } finally {
      setApplyingAmbig(false);
    }
  }

  async function applyImportMissing(): Promise<void> {
    const selected = notMatchedList.filter(o => importChecked[o.eos_id]);
    if (selected.length === 0) {
      setImportModalOpen(false);
      return;
    }
    setImporting(true);
    try {
      const res = await playersApi.importFromProfiles(
        selected.map(o => ({ eos_id: o.eos_id, player_name: o.player_name || null })),
      );
      toast.success(t("players.importMissing.done", { n: res.data.inserted, s: res.data.skipped_existing }));
      // Drop imported ones so the banner count goes down; the admin can
      // reopen the modal to retry partial failures.
      setNotMatchedList(prev => prev.filter(o => !importChecked[o.eos_id]));
      setImportChecked({});
      setImportModalOpen(false);
      loadPlayers();
      loadStats();
    } catch (err) {
      toast.error(extractError(err, t("players.importMissing.errors.apply")));
    } finally {
      setImporting(false);
    }
  }

  /**
   * Sibling of handleSyncNames: scans .arktribe files and writes the names
   * into ARKM_player_tribes + ARKM_tribe_decay. Same SSH plumbing.
   */
  async function handleSyncTribes() {
    setSyncingTribes(true);
    try {
      const res = await playersApi.syncTribes();
      const updates = res.data.player_tribes_rows_updated + res.data.tribe_decay_rows_updated;
      toast.success(
        t("players.tribeSync.done", {
          scanned: res.data.total_files_scanned,
          matched: res.data.matched,
          rows: updates,
        }),
      );
      if (updates > 0) loadPlayers();
      if (res.data.errors?.length > 0) {
        toast.error(t("players.messages.syncErrors", { errors: res.data.errors.join("; ") }));
      }
    } catch (err) {
      toast.error(extractError(err, t("players.tribeSync.failed")));
    } finally {
      setSyncingTribes(false);
    }
  }

  return {
    syncing,
    syncingTribes,
    syncResult,
    setSyncResult,
    showSyncPanel,
    setShowSyncPanel,
    handleSyncNames,
    handleSyncTribes,
    ambiguousList,
    chosenNames,
    setChosenNames,
    applyingAmbig,
    closeAmbiguous,
    applyAmbiguousResolutions,
    notMatchedList,
    setNotMatchedList,
    importModalOpen,
    setImportModalOpen,
    importChecked,
    setImportChecked,
    importing,
    applyImportMissing,
  };
}

export type NameSync = ReturnType<typeof useNameSync>;
