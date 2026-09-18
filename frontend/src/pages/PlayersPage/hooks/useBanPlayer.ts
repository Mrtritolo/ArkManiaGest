/**
 * useBanPlayer — the inline ban form of the detail panel.
 *
 * The state lives at page level (not inside the panel) so the form survives
 * closing and reopening the panel, exactly as it did before the split.
 * `banned_by` is NOT sent: the backend records the JWT user.
 */
import { useCallback, useState } from "react";
import type { TFunction } from "i18next";
import { arkBansApi } from "../../../services/api";
import { extractError } from "../../../utils/errors";
import type { ToastApi } from "../../../components/ui";
import type { PlayerFull } from "../../../types";

export type BanDuration = "permanent" | "1d" | "3d" | "7d" | "30d";

interface Args {
  selectedPlayer: PlayerFull | null;
  toast: ToastApi;
  t: TFunction;
}

export function useBanPlayer({ selectedPlayer, toast, t }: Args) {
  const [showBanDialog, setShowBanDialog] = useState(false);
  const [banReason, setBanReason] = useState(t("players.ban.defaultReason"));
  const [banDuration, setBanDuration] = useState<BanDuration>("permanent");
  const [banning, setBanning] = useState(false);

  /** Called by openDetail: a pending ban form never carries over to a new player. */
  const closeDialog = useCallback(() => setShowBanDialog(false), []);

  async function handleBanPlayer() {
    if (!selectedPlayer) return;
    setBanning(true);
    try {
      let expireTime: string | undefined;
      if (banDuration !== "permanent") {
        const days = { "1d": 1, "3d": 3, "7d": 7, "30d": 30 }[banDuration];
        const dt = new Date();
        dt.setDate(dt.getDate() + days);
        expireTime = dt.toISOString();
      }
      await arkBansApi.create({
        eos_id: selectedPlayer.eos_id,
        player_name: selectedPlayer.name || undefined,
        reason: banReason || t("players.ban.noReason"),
        expire_time: expireTime,
      });
      const who = selectedPlayer.name || selectedPlayer.eos_id;
      toast.success(
        banDuration === "permanent"
          ? t("players.messages.bannedPermanent", { name: who })
          : t("players.messages.bannedTemporary", { name: who, duration: banDuration }),
      );
      setShowBanDialog(false);
      setBanReason(t("players.ban.defaultReason"));
      setBanDuration("permanent");
    } catch (err) {
      toast.error(extractError(err, t("players.errors.banFailed")));
    } finally {
      setBanning(false);
    }
  }

  return {
    showBanDialog,
    setShowBanDialog,
    closeDialog,
    banReason,
    setBanReason,
    banDuration,
    setBanDuration,
    banning,
    handleBanPlayer,
  };
}

export type BanPlayer = ReturnType<typeof useBanPlayer>;
