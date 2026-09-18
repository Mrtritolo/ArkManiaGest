/**
 * usePlayerDetail — the selected player and every edit made in the side panel.
 *
 * Stale-response guards: `detailReqRef` lets only the latest openDetail fill
 * the panel, `shownPlayerRef` holds the id the panel currently shows so a slow
 * response for player A never lands after the operator moved to B.
 *
 * Unsaved permission edits are guarded by useConfirm before the panel closes
 * or switches to another player.
 */
import { useCallback, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { playersApi } from "../../../services/api";
import { extractError } from "../../../utils/errors";
import { usePending } from "../../../hooks/usePending";
import type { ConfirmOptions, ToastApi } from "../../../components/ui";
import type { PlayerFull } from "../../../types";
import { parseFixedGroups, parseTimedPerms, serializeTimedPerms, type TimedPerm } from "../playersUtils";

export type SaveKey = "points" | "fixed" | "timed";

/**
 * Neither stored column is canonical: `PermissionGroups` defaults to
 * "Default," and both carry trailing separators and stray whitespace, while
 * the editor always writes a normalised string back. Comparing the edited
 * value against the raw column therefore called every untouched player dirty,
 * so both sides go through the same normalisation before they are compared.
 */
function normFixed(raw: string | null | undefined): string {
  return parseFixedGroups(raw).join(",");
}

function normTimed(raw: string | null | undefined): string {
  return serializeTimedPerms(parseTimedPerms(raw));
}

interface Args {
  /** Viewers cannot edit anything here, so they are never "dirty". */
  canOperate: boolean;
  toast: ToastApi;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  loadPlayers: (s?: string, g?: string) => void;
  loadStats: () => void;
  /** Runs right before the new player is swapped in (resets maps + ban form). */
  onBeforeOpen: () => void;
  t: TFunction;
}

export function usePlayerDetail({ canOperate, toast, confirm, loadPlayers, loadStats, onBeforeOpen, t }: Args) {
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerFull | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pointsInput, setPointsInput] = useState("");
  const [permInput, setPermInput] = useState("");
  const [timedPerms, setTimedPerms] = useState<TimedPerm[]>([]);
  const pending = usePending<SaveKey>();

  const detailReqRef = useRef(0);
  const shownPlayerRef = useRef<number | null>(null);

  const dirty =
    canOperate &&
    selectedPlayer !== null &&
    (normFixed(permInput) !== normFixed(selectedPlayer.permission_groups) ||
      serializeTimedPerms(timedPerms) !== normTimed(selectedPlayer.timed_permission_groups));

  const confirmDiscard = useCallback(async () => {
    if (!dirty) return true;
    return confirm({
      title: t("players.unsaved.title"),
      description: t("players.unsaved.description"),
      confirmLabel: t("players.unsaved.discard"),
      cancelLabel: t("players.unsaved.keepEditing"),
      tone: "danger",
    });
  }, [confirm, dirty, t]);

  async function openDetail(id: number) {
    if (selectedPlayer && selectedPlayer.id !== id && !(await confirmDiscard())) return;
    const seq = ++detailReqRef.current;
    setDetailLoading(true);
    try {
      const res = await playersApi.get(id);
      if (seq !== detailReqRef.current) return;
      // Swap the whole panel in one go, once the new player's data is here.
      shownPlayerRef.current = id;
      onBeforeOpen();
      setSelectedPlayer(res.data);
      setPointsInput(String(res.data.points ?? 0));
      setPermInput(res.data.permission_groups);
      setTimedPerms(parseTimedPerms(res.data.timed_permission_groups));
    } catch (err) {
      if (seq === detailReqRef.current) toast.error(extractError(err, t("players.errors.detail")));
    } finally {
      if (seq === detailReqRef.current) setDetailLoading(false);
    }
  }

  async function closeDetail() {
    if (!(await confirmDiscard())) return;
    detailReqRef.current++;
    shownPlayerRef.current = null;
    setDetailLoading(false);
    setSelectedPlayer(null);
  }

  /**
   * A bulk grant/align rewrites TimedPermissionGroups server side. If the
   * panel shows one of those players, its editor still holds the old list and
   * "Save timed perms" would PUT it back over the bulk change.
   */
  const reloadShownPlayerIfIn = useCallback(
    async (ids: number[]) => {
      const shown = shownPlayerRef.current;
      if (shown === null || !ids.includes(shown)) return;
      try {
        const res = await playersApi.get(shown);
        if (shownPlayerRef.current !== shown) return;
        setSelectedPlayer(res.data);
        setTimedPerms(parseTimedPerms(res.data.timed_permission_groups));
      } catch (err) {
        if (shownPlayerRef.current === shown) toast.error(extractError(err, t("players.errors.detail")));
      }
    },
    [t, toast],
  );

  async function handleSetPoints() {
    if (!selectedPlayer) return;
    const id = selectedPlayer.id;
    const val = parseInt(pointsInput);
    if (isNaN(val) || val < 0) {
      toast.error(t("players.errors.invalidPoints"));
      return;
    }
    try {
      await pending.run("points", async () => {
        await playersApi.setPoints(id, val);
        toast.success(t("players.messages.pointsSet", { value: val }));
        setSelectedPlayer(prev => (prev?.id === id ? { ...prev, points: val } : prev));
        loadPlayers();
        loadStats();
      });
    } catch (err) {
      toast.error(extractError(err, t("players.errors.generic")));
    }
  }

  async function handleAddPoints(amount: number) {
    if (!selectedPlayer) return;
    const id = selectedPlayer.id;
    try {
      await pending.run("points", async () => {
        const res = await playersApi.addPoints(id, amount);
        toast.success(
          amount > 0
            ? t("players.messages.pointsChangedPositive", { amount, total: res.data.points })
            : t("players.messages.pointsChangedNegative", { amount, total: res.data.points }),
        );
        setSelectedPlayer(prev => (prev?.id === id ? { ...prev, points: res.data.points } : prev));
        if (shownPlayerRef.current === id) setPointsInput(String(res.data.points));
        loadPlayers();
        loadStats();
      });
    } catch (err) {
      toast.error(extractError(err, t("players.errors.generic")));
    }
  }

  async function handleSavePermissions() {
    if (!selectedPlayer) return;
    const id = selectedPlayer.id;
    const value = permInput;
    try {
      await pending.run("fixed", async () => {
        await playersApi.update(id, { permission_groups: value });
        toast.success(t("players.messages.fixedPermsUpdated"));
        setSelectedPlayer(prev => (prev?.id === id ? { ...prev, permission_groups: value } : prev));
        loadPlayers();
      });
    } catch (err) {
      toast.error(extractError(err, t("players.errors.generic")));
    }
  }

  function handleTimedPermChange(i: number, field: keyof TimedPerm, value: string | number) {
    setTimedPerms(prev => prev.map((p, idx) => (idx === i ? { ...p, [field]: value } : p)));
  }

  async function handleSaveTimedPermissions() {
    if (!selectedPlayer) return;
    const id = selectedPlayer.id;
    const s = serializeTimedPerms(timedPerms);
    try {
      await pending.run("timed", async () => {
        await playersApi.update(id, { timed_permission_groups: s });
        toast.success(t("players.messages.timedPermsUpdated"));
        setSelectedPlayer(prev => (prev?.id === id ? { ...prev, timed_permission_groups: s } : prev));
        loadPlayers();
      });
    } catch (err) {
      toast.error(extractError(err, t("players.errors.generic")));
    }
  }

  return {
    selectedPlayer,
    detailLoading,
    dirty,
    confirmDiscard,
    openDetail,
    closeDetail,
    shownPlayerRef,
    reloadShownPlayerIfIn,
    pointsInput,
    setPointsInput,
    permInput,
    setPermInput,
    timedPerms,
    setTimedPerms,
    isSaving: (key: SaveKey) => pending.isPending(key),
    handleSetPoints,
    handleAddPoints,
    handleSavePermissions,
    handleTimedPermChange,
    handleSaveTimedPermissions,
  };
}

export type PlayerDetail = ReturnType<typeof usePlayerDetail>;
