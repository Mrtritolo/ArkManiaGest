/**
 * useCharacterWipe — the cluster-wide .arkprofile wipe (admin only).
 *
 * Two steps: GET the file list for the EOS, then DELETE it. The modal is bound
 * to the player it was opened for, not to whatever the panel shows later, and
 * `wipeReqRef` lets only the latest opening fill it. The DELETE itself is an
 * irreversible mass action, so it is confirmed with a typed confirmation.
 */
import { useRef, useState } from "react";
import type { TFunction } from "i18next";
import { playersApi } from "../../../services/api";
import { extractError } from "../../../utils/errors";
import type { ConfirmOptions, ToastApi } from "../../../components/ui";
import type { PlayerFull } from "../../../types";

export interface WipePreview {
  eos_id: string;
  total_files: number;
  files: Array<{ path: string; container: string; machine_id: number }>;
  errors: string[];
}

export interface WipeTarget {
  name: string | null;
  eos_id: string;
}

interface Args {
  selectedPlayer: PlayerFull | null;
  toast: ToastApi;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  t: TFunction;
}

export function useCharacterWipe({ selectedPlayer, toast, confirm, t }: Args) {
  const [wipeOpen, setWipeOpen] = useState(false);
  const [wipePreview, setWipePreview] = useState<WipePreview | null>(null);
  const [wipeLoading, setWipeLoading] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [wipeTarget, setWipeTarget] = useState<WipeTarget | null>(null);
  const wipeReqRef = useRef(0);

  async function openWipeModal(): Promise<void> {
    if (!selectedPlayer) return;
    const target = { name: selectedPlayer.name, eos_id: selectedPlayer.eos_id };
    const seq = ++wipeReqRef.current;
    setWipeTarget(target);
    setWipeOpen(true);
    setWipePreview(null);
    setWipeLoading(true);
    try {
      const res = await playersApi.listCharacterFiles(target.eos_id);
      // A superseded opening (closed and reopened meanwhile) must not fill
      // the newer modal; the newer request owns it.
      if (seq !== wipeReqRef.current) return;
      setWipePreview(res.data);
    } catch (err) {
      if (seq !== wipeReqRef.current) return;
      toast.error(extractError(err, t("players.wipe.errors.preview")));
      setWipeOpen(false);
    } finally {
      if (seq === wipeReqRef.current) setWipeLoading(false);
    }
  }

  function close() {
    if (wiping) return;
    setWipeOpen(false);
    setWipePreview(null);
  }

  async function confirmWipe(): Promise<void> {
    if (!wipePreview) return;
    const ok = await confirm({
      title: t("players.wipe.confirmTitle"),
      description: t("players.wipe.confirmBody", {
        n: wipePreview.total_files,
        name: wipeTarget?.name || t("players.unknownPlayer"),
      }),
      confirmLabel: t("players.wipe.confirm", { n: wipePreview.total_files }),
      tone: "danger",
      confirmText: t("players.wipe.confirmWord"),
    });
    if (!ok) return;
    setWiping(true);
    try {
      // Wipe exactly the EOS whose files the operator just reviewed.
      const res = await playersApi.deleteCharacterFiles(wipePreview.eos_id);
      toast.success(
        res.data.db_row_removed
          ? t("players.wipe.doneWithRow", { n: res.data.total_deleted })
          : t("players.wipe.done", { n: res.data.total_deleted }),
      );
      if (res.data.errors?.length > 0) {
        toast.error(res.data.errors.join("; "));
      }
      setWipeOpen(false);
      setWipePreview(null);
    } catch (err) {
      toast.error(extractError(err, t("players.wipe.errors.delete")));
    } finally {
      setWiping(false);
    }
  }

  return { wipeOpen, wipePreview, wipeLoading, wiping, wipeTarget, openWipeModal, close, confirmWipe };
}

export type CharacterWipe = ReturnType<typeof useCharacterWipe>;
