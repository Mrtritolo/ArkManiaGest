/**
 * useBulkTimedPerms — the two bulk workflows driven by the row checkboxes.
 *
 *  * Bulk grant: extend (or create) ONE timed permission on every selected
 *    player by a delta. The backend bumps an existing expiry by that delta and
 *    inserts `now + delta` for the players that do not have the group.
 *  * Bulk align: pick a family of related groups and align the expiry of every
 *    ACTIVE entry in the family to the latest active timestamp per player.
 *    Expired entries are never touched. The family is persisted in
 *    localStorage so the operator does not have to re-pick it.
 *
 * The selection comes from useSelection, so a bulk action can only ever reach
 * rows the operator can actually see.
 */
import { useCallback, useState } from "react";
import type { TFunction } from "i18next";
import { playersApi } from "../../../services/api";
import { extractError } from "../../../utils/errors";
import type { ToastApi } from "../../../components/ui";
import type { Selection } from "../../../hooks/useSelection";
import { loadAlignGroups, saveAlignGroups } from "../playersUtils";

const WEEK_SECONDS = 7 * 24 * 3600;

interface Args {
  selection: Selection<number>;
  toast: ToastApi;
  loadPlayers: (s?: string, g?: string) => void;
  reloadShownPlayerIfIn: (ids: number[]) => void;
  t: TFunction;
}

export function useBulkTimedPerms({ selection, toast, loadPlayers, reloadShownPlayerIfIn, t }: Args) {
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkGroup, setBulkGroup] = useState("");
  const [bulkDurationSeconds, setBulkDurationSeconds] = useState(WEEK_SECONDS);
  const [bulkApplying, setBulkApplying] = useState(false);

  const [alignModalOpen, setAlignModalOpen] = useState(false);
  const [alignGroups, setAlignGroups] = useState<string[]>(loadAlignGroups);
  const [alignApplying, setAlignApplying] = useState(false);

  function openBulkModal() {
    setBulkGroup("");
    setBulkDurationSeconds(WEEK_SECONDS);
    setBulkModalOpen(true);
  }

  async function handleBulkApply() {
    if (selection.count === 0) {
      toast.error(t("players.bulkPerm.errorNoneSelected"));
      return;
    }
    if (!bulkGroup) {
      toast.error(t("players.bulkPerm.errorNoGroup"));
      return;
    }
    if (bulkDurationSeconds < 60) {
      toast.error(t("players.bulkPerm.errorBadDuration"));
      return;
    }

    // No second confirmation: the dialog the operator is standing in (group +
    // duration + the semantics note) IS the confirmation step. The native
    // dialog that used to sit on top of it was pure friction.
    setBulkApplying(true);
    const ids = Array.from(selection.selected);
    try {
      const res = await playersApi.bulkAddTimedPerm({
        player_ids: ids,
        group: bulkGroup,
        duration_seconds: bulkDurationSeconds,
      });
      toast.success(
        t("players.bulkPerm.done", {
          updated: res.data.updated,
          extended: res.data.extended,
          added: res.data.added,
          missing: res.data.missing_ids.length,
        }),
      );
      selection.clear();
      setBulkModalOpen(false);
      loadPlayers();
      reloadShownPlayerIfIn(ids);
    } catch (err) {
      toast.error(extractError(err, t("players.bulkPerm.failed")));
    } finally {
      setBulkApplying(false);
    }
  }

  const persistAlignGroups = useCallback((groups: string[]) => {
    setAlignGroups(groups);
    saveAlignGroups(groups);
  }, []);

  const toggleAlignGroup = useCallback(
    (name: string) => {
      persistAlignGroups(
        alignGroups.includes(name) ? alignGroups.filter(g => g !== name) : [...alignGroups, name],
      );
    },
    [alignGroups, persistAlignGroups],
  );

  const addAlignGroup = useCallback(
    (name: string) => {
      const v = name.trim();
      if (v && !alignGroups.includes(v)) persistAlignGroups([...alignGroups, v]);
    },
    [alignGroups, persistAlignGroups],
  );

  async function handleBulkAlign() {
    if (selection.count === 0) {
      toast.error(t("players.bulkAlign.errorNoneSelected"));
      return;
    }
    if (alignGroups.length < 2) {
      toast.error(t("players.bulkAlign.errorTooFewGroups"));
      return;
    }

    // Same as the bulk grant: the dialog is the confirmation.
    setAlignApplying(true);
    const ids = Array.from(selection.selected);
    try {
      const res = await playersApi.bulkAlignTimedPerms({ player_ids: ids, groups: alignGroups });
      toast.success(
        t("players.bulkAlign.done", {
          aligned: res.data.aligned_players,
          entries: res.data.aligned_entries,
          skipped: res.data.skipped_players,
          missing: res.data.missing_ids.length,
        }),
      );
      setAlignModalOpen(false);
      selection.clear();
      loadPlayers();
      reloadShownPlayerIfIn(ids);
    } catch (err) {
      toast.error(extractError(err, t("players.bulkAlign.failed")));
    } finally {
      setAlignApplying(false);
    }
  }

  return {
    bulkModalOpen,
    setBulkModalOpen,
    bulkGroup,
    setBulkGroup,
    bulkDurationSeconds,
    setBulkDurationSeconds,
    bulkApplying,
    openBulkModal,
    handleBulkApply,
    alignModalOpen,
    setAlignModalOpen,
    alignGroups,
    alignApplying,
    toggleAlignGroup,
    addAlignGroup,
    handleBulkAlign,
  };
}

export type BulkTimedPerms = ReturnType<typeof useBulkTimedPerms>;
