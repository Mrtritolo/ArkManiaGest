/**
 * usePurchaseConfirm -- the one purchase confirmation shared by the three buy
 * flows (browse listing, server shop / genes, egg-embryo forge).
 *
 * The caller hands in a `run` that already knows what it is buying: the
 * closure captures key, label and price at click time, so editing the forge
 * form while the dialog is open cannot change what gets bought.
 *
 * `run` rejects with an already-translated message when the purchase fails.
 * The dialog then STAYS OPEN and shows that message, instead of closing and
 * leaving the player to find the error somewhere up the page.
 */
import { useCallback, useRef, useState } from "react";

export interface PendingBuy {
  label: string;
  price: number;
  run: () => Promise<void>;
}

export interface PurchaseConfirm {
  pendingBuy: PendingBuy | null;
  pendingBusy: boolean;
  pendingError: string;
  requestBuy: (buy: PendingBuy) => void;
  cancel: () => void;
  confirm: () => Promise<void>;
}

export function usePurchaseConfirm(): PurchaseConfirm {
  const [pendingBuy, setPendingBuy] = useState<PendingBuy | null>(null);
  const [pendingBusy, setPendingBusy] = useState(false);
  const [pendingError, setPendingError] = useState("");
  // Synchronous mirror of pendingBusy: Escape and the backdrop read it from
  // callbacks that may run before the state update lands.
  const busyRef = useRef(false);

  const requestBuy = useCallback((buy: PendingBuy) => {
    setPendingError("");
    setPendingBuy(buy);
  }, []);

  // A cancel while the purchase is in flight is ignored: the points may
  // already be gone and the dialog is the only place showing the outcome.
  const cancel = useCallback(() => {
    if (busyRef.current) return;
    setPendingBuy(null);
    setPendingError("");
  }, []);

  const confirm = useCallback(async () => {
    // busyRef: a second confirm while the first purchase is in flight would
    // charge twice.
    if (!pendingBuy || busyRef.current) return;
    busyRef.current = true;
    setPendingBusy(true);
    setPendingError("");
    try {
      await pendingBuy.run();
      setPendingBuy(null);
    } catch (err: unknown) {
      setPendingError((err as { message?: string })?.message || String(err));
    } finally {
      busyRef.current = false;
      setPendingBusy(false);
    }
  }, [pendingBuy]);

  return { pendingBuy, pendingBusy, pendingError, requestBuy, cancel, confirm };
}
