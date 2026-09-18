/**
 * useMarketplace -- the player-to-player marketplace half of the page:
 * browse, my items, wallet and transaction history.
 *
 * The web shop (ArkShop / GeneShop / forge) lives in useWebShop: the two
 * share only the page and the wallet.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { marketApi, type MarketListedItem, type MarketMyItem, type MarketTransaction, type MarketWallet } from "../../../services/api";
import { useDebouncedValue } from "../../../hooks/useDebouncedValue";
import { arkItemDisplayName } from "../../../utils/arkItem";
import { extractError, listedError, LISTED_PAGE, type TFunc } from "../marketUtils";
import type { PendingBuy } from "./usePurchaseConfirm";
import type { ConfirmOptions, ToastApi } from "../../../components/ui";

export type MarketSort = "newest" | "price_asc" | "price_desc";

interface Args {
  /** Raw setter: a page-load failure becomes the page Alert. */
  setLoadError: (message: string) => void;
  toast: ToastApi;
  requestBuy: (buy: PendingBuy) => void;
  /** useConfirm(): destructive actions never use a native dialog. */
  askConfirm: (options: ConfirmOptions) => Promise<boolean>;
  t: TFunc;
}

export function useMarketplace({ setLoadError, toast, requestBuy, askConfirm, t }: Args) {
  // Latest `t` without making the loaders change identity on every render.
  const tRef = useRef(t);
  tRef.current = t;

  // Browse
  const [listed, setListed] = useState<MarketListedItem[]>([]);
  const [listedTotal, setListedTotal] = useState(0);
  const [listedLoading, setListedLoading] = useState(true);
  const [listedMoreLoading, setListedMoreLoading] = useState(false);
  const [searchBp, setSearchBp] = useState("");
  // What the list is actually queried with: searchBp after a short pause, so
  // typing does not fire one request per keystroke.
  const debouncedBp = useDebouncedValue(searchBp, 300);
  // Enter applies the current text immediately, ahead of the debounce.
  const [forcedBp, setForcedBp] = useState<string | null>(null);
  const appliedBp = forcedBp !== null && forcedBp === searchBp ? forcedBp : debouncedBp;
  const [sort, setSort] = useState<MarketSort>("newest");
  // Bumped by every fresh query: a response whose number is no longer the
  // current one belongs to an older search and is dropped.
  const listedSeq = useRef(0);

  // My items
  const [myItems, setMyItems] = useState<MarketMyItem[]>([]);
  const [myLoading, setMyLoading] = useState(false);
  const [priceInput, setPriceInput] = useState<Record<number, string>>({});
  const [priceError, setPriceError] = useState<Record<number, string>>({});
  // Item with a publish/cancel request in flight (double-click guard).
  const [myBusyId, setMyBusyId] = useState<number | null>(null);

  // Wallet
  const [wallet, setWallet] = useState<MarketWallet | null>(null);

  // History
  const [history, setHistory] = useState<MarketTransaction[]>([]);
  const [histLoading, setHistLoading] = useState(false);

  const loadWallet = useCallback(async () => {
    try {
      const res = await marketApi.myWallet();
      setWallet(res.data);
    } catch {
      // 401/403 -- silently null (we're an admin without a Discord link)
      setWallet(null);
    }
  }, []);

  const loadListed = useCallback(async () => {
    const seq = ++listedSeq.current;
    setListedLoading(true);
    setLoadError("");
    try {
      const res = await marketApi.listed({
        limit: LISTED_PAGE,
        blueprint: appliedBp || undefined,
        sort,
      });
      if (seq !== listedSeq.current) return;
      setListed(res.data.items);
      setListedTotal(res.data.total);
    } catch (err) {
      if (seq !== listedSeq.current) return;
      setLoadError(listedError(err, tRef.current));
    } finally {
      if (seq === listedSeq.current) setListedLoading(false);
    }
  }, [appliedBp, sort, setLoadError]);

  /** Next page of the current query, appended (the backend caps a page). */
  const loadMoreListed = useCallback(async () => {
    if (listedMoreLoading) return;
    const seq = listedSeq.current;
    setListedMoreLoading(true);
    try {
      const res = await marketApi.listed({
        limit: LISTED_PAGE,
        offset: listed.length,
        blueprint: appliedBp || undefined,
        sort,
      });
      if (seq !== listedSeq.current) return;
      // Listings sold or added meanwhile shift the pages: skip duplicates.
      setListed(prev => {
        const seen = new Set(prev.map(i => i.id));
        return [...prev, ...res.data.items.filter(i => !seen.has(i.id))];
      });
      setListedTotal(res.data.total);
    } catch (err) {
      if (seq === listedSeq.current) setLoadError(listedError(err, tRef.current));
    } finally {
      setListedMoreLoading(false);
    }
  }, [listedMoreLoading, listed.length, appliedBp, sort, setLoadError]);

  const loadMyItems = useCallback(async () => {
    setMyLoading(true);
    try {
      const res = await marketApi.myItems();
      setMyItems(res.data);
    } catch (err) {
      setLoadError(extractError(err, tRef.current("market.errors.loadMine"), tRef.current));
    } finally {
      setMyLoading(false);
    }
  }, [setLoadError]);

  const loadHistory = useCallback(async () => {
    setHistLoading(true);
    try {
      const res = await marketApi.myTransactions();
      setHistory(res.data.transactions);
    } catch (err) {
      setLoadError(extractError(err, tRef.current("market.errors.loadHistory"), tRef.current));
    } finally {
      setHistLoading(false);
    }
  }, [setLoadError]);

  /** Apply the search now (Enter), without waiting for the debounce. */
  const applySearchNow = useCallback(() => {
    setForcedBp(searchBp);
  }, [searchBp]);

  function handleBuy(item: MarketListedItem) {
    requestBuy({
      label: arkItemDisplayName(item.blueprint),
      price: item.price,
      run: async () => {
        try {
          const res = await marketApi.buy(item.id);
          toast.success(t("market.bought", { b: res.data.new_balance }));
          setListed(prev => prev.filter(i => i.id !== item.id));
          setListedTotal(n => Math.max(0, n - 1));
          loadWallet();
        } catch (err) {
          // Someone else bought it (or it was withdrawn): drop the stale
          // card so its Buy button cannot repeat the failing purchase.
          const code = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
          if (code === "ITEM_NOT_AVAILABLE" || code === "ITEM_NOT_FOUND") {
            setListed(prev => prev.filter(i => i.id !== item.id));
            setListedTotal(n => Math.max(0, n - 1));
          }
          // INSUFFICIENT_FUNDS usually means points were spent in game.
          loadWallet();
          // Rejecting keeps the confirmation dialog open with this message.
          throw new Error(extractError(err, t("market.errors.buy"), t));
        }
      },
    });
  }

  async function handleList(itemId: number) {
    if (myBusyId !== null) return;
    const price = Number((priceInput[itemId] || "").trim());
    // Integers only: parseInt silently turned "12.5" into 12.
    if (!Number.isInteger(price) || price <= 0) {
      setPriceError(p => ({ ...p, [itemId]: t("market.errors.priceRequired") }));
      return;
    }
    setPriceError(p => ({ ...p, [itemId]: "" }));
    setMyBusyId(itemId);
    try {
      await marketApi.listForSale(itemId, price);
      toast.success(t("market.listed"));
      setPriceInput(p => ({ ...p, [itemId]: "" }));
      loadMyItems();
      loadListed();
    } catch (err) {
      toast.error(extractError(err, t("market.errors.list"), t));
    } finally {
      setMyBusyId(null);
    }
  }

  async function handleCancel(itemId: number) {
    if (myBusyId !== null) return;
    if (!(await askConfirm({
      title: t("market.confirmCancelTitle"),
      description: t("market.confirmCancel"),
      confirmLabel: t("market.cancel"),
      tone: "danger",
    }))) return;
    setMyBusyId(itemId);
    try {
      await marketApi.cancel(itemId);
      toast.success(t("market.cancelled"));
      loadMyItems();
      loadListed();
    } catch (err) {
      toast.error(extractError(err, t("market.errors.cancel"), t));
    } finally {
      setMyBusyId(null);
    }
  }

  // Stats grouped per status -- shown in the My-Items tab
  const myStats = useMemo(() => {
    const out = { draft: 0, listed: 0, sold: 0, claimed: 0 };
    for (const it of myItems) if (it.role === "owner") out[it.status as keyof typeof out]++;
    return out;
  }, [myItems]);

  return {
    listed, listedTotal, listedLoading, listedMoreLoading,
    searchBp, setSearchBp, applySearchNow, sort, setSort,
    myItems, myLoading, myBusyId, priceInput, setPriceInput, priceError,
    wallet, history, histLoading, myStats,
    loadListed, loadMoreListed, loadWallet, loadMyItems, loadHistory,
    handleBuy, handleList, handleCancel,
  };
}
