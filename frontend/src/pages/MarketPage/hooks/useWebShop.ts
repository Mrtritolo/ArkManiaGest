/**
 * useWebShop -- the server-run shop half of the page: the ArkShop catalogue,
 * the GeneShop traits, the egg/embryo configs and the player's own orders.
 *
 * The catalogue search stays global (it searches every category, not only the
 * selected one) because someone typing "flak" wants to find the flak, not to
 * discover they are in the wrong section.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import {
  webShopApi,
  type WebShopForgeConfig, type WebShopForgePrice, type WebShopGene,
  type WebShopGeneDino, type WebShopItem, type WebShopOrder,
} from "../../../services/api";
import { extractError, SHOP_CATEGORY_ORDER, type TFunc } from "../marketUtils";
import type { PendingBuy } from "./usePurchaseConfirm";
import type { ToastApi } from "../../../components/ui";

interface Args {
  setLoadError: (message: string) => void;
  toast: ToastApi;
  loadWallet: () => Promise<void>;
  requestBuy: (buy: PendingBuy) => void;
  t: TFunc;
}

export function useWebShop({ setLoadError, toast, loadWallet, requestBuy, t }: Args) {
  const tRef = useRef(t);
  tRef.current = t;

  const [shopItems, setShopItems] = useState<WebShopItem[]>([]);
  const [shopGenes, setShopGenes] = useState<WebShopGene[]>([]);
  const [shopGeneDinos, setShopGeneDinos] = useState<WebShopGeneDino[]>([]);
  const [shopOrders, setShopOrders] = useState<WebShopOrder[]>([]);
  const [shopPending, setShopPending] = useState(0);
  const [shopLoading, setShopLoading] = useState(false);
  const [shopBusy, setShopBusy] = useState<string | null>(null);
  const [shopSearch, setShopSearch] = useState("");
  const [shopCat, setShopCat] = useState("");   // "" = every category
  const [geneTier, setGeneTier] = useState<Record<string, number>>({});
  // One species for the whole tab, not one per trait: you pick the dino first
  // and the trait second, the way you would when scanning in game.
  const [geneSpecies, setGeneSpecies] = useState("");

  // Egg / embryo shops (the "forge" configurator)
  const [eggShopCfg, setEggShopCfg] = useState<WebShopForgeConfig | null>(null);
  const [embryoShopCfg, setEmbryoShopCfg] = useState<WebShopForgeConfig | null>(null);
  const [forgePrices, setForgePrices] = useState<WebShopForgePrice[]>([]);

  // Which bundle has its contents open. One at a time: opening several turns
  // the grid into a wall of lists.
  const [openPack, setOpenPack] = useState<string | null>(null);

  const loadShop = useCallback(async () => {
    setShopLoading(true);
    try {
      const r = await webShopApi.catalog();
      setShopItems(r.data.items || []);
      setShopGenes(r.data.genes || []);
      setShopGeneDinos(r.data.gene_dinos || []);
      setEggShopCfg(r.data.egg_shop || null);
      setEmbryoShopCfg(r.data.embryo_shop || null);
      setForgePrices(r.data.forge_prices || []);
    } catch (e: unknown) {
      setLoadError(extractError(e, tRef.current("market.errors.loadShop"), tRef.current));
    } finally {
      setShopLoading(false);
    }
  }, [setLoadError]);

  const loadShopOrders = useCallback(async () => {
    try {
      const r = await webShopApi.orders();
      setShopOrders(r.data.orders || []);
      setShopPending(r.data.pending || 0);
    } catch { /* the queued count is a bonus, not an error worth showing */ }
  }, []);

  /** Operator: fill the web window from the ArkShop catalogue. */
  async function doImport() {
    setShopBusy("__import");
    try {
      const r = await webShopApi.importArkshop();
      const skipped = Object.entries(r.data.skipped || {})
        .map(([k, v]) => `${k}: ${v}`).join(", ");
      toast.success(t("market.shop.imported", {
        n: r.data.imported, skipped: skipped || "-" }));
      await loadShop();
    } catch (e: unknown) {
      toast.error(extractError(e, t("market.errors.import"), t));
    } finally {
      setShopBusy(null);
    }
  }

  /**
   * Buy and queue. Reloads the wallet straight after: the points are what the
   * player checks to know whether it worked.
   */
  function doBuy(kind: "item" | "dino" | "gene", key: string,
                 label: string, price: number, tier = 1,
                 species = "") {
    requestBuy({ label, price, run: async () => {
      setShopBusy(key);
      try {
        const r = await webShopApi.buy(kind, key, 1, tier, species);
        toast.success(t("market.shop.bought", { spent: r.data.spent }));
        await Promise.all([loadWallet(), loadShopOrders()]);
      } catch (e: unknown) {
        // The balance may have moved in game since it was loaded (that is
        // the usual reason for INSUFFICIENT_FUNDS): show the real one.
        loadWallet();
        throw new Error(extractError(e, t("market.errors.buy"), t));
      } finally {
        setShopBusy(null);
      }
    }});
  }

  /** How many entries each category has, before the category filter. */
  const shopCatCounts = useMemo(() => {
    const q = shopSearch.trim().toLowerCase();
    const out: Record<string, number> = {};
    for (const i of shopItems) {
      if (q && !i.label.toLowerCase().includes(q)) continue;
      const c = i.category || "other";
      out[c] = (out[c] ?? 0) + 1;
    }
    return out;
  }, [shopItems, shopSearch]);

  /** Chip order: known categories first, then unknown slugs (as shopGroups). */
  const shopCatChips = useMemo(() => {
    const known = SHOP_CATEGORY_ORDER.filter(c => shopCatCounts[c]);
    const rest = Object.keys(shopCatCounts).filter(c => !SHOP_CATEGORY_ORDER.includes(c)).sort();
    return [...known, ...rest];
  }, [shopCatCounts]);

  /** Entries that pass search + category. */
  const shopVisible = useMemo(() => {
    const q = shopSearch.trim().toLowerCase();
    return shopItems.filter(i =>
      (!q || i.label.toLowerCase().includes(q)) &&
      (!shopCat || (i.category || "other") === shopCat));
  }, [shopItems, shopSearch, shopCat]);

  /** [category, entries][] in reading order; empty ones do not appear. */
  const shopGroups = useMemo(() => {
    const by = new Map<string, WebShopItem[]>();
    for (const i of shopVisible) {
      const c = i.category || "other";
      const bucket = by.get(c);
      if (bucket) bucket.push(i);
      else by.set(c, [i]);
    }
    // An unknown category (a new slug on the backend) does not disappear: it
    // lands at the bottom, after the known ones.
    const known = SHOP_CATEGORY_ORDER.filter(c => by.has(c));
    const rest = [...by.keys()].filter(c => !SHOP_CATEGORY_ORDER.includes(c)).sort();
    return [...known, ...rest].map(c => [c, by.get(c)!] as const);
  }, [shopVisible]);

  return {
    shopItems, shopGenes, shopGeneDinos, shopOrders, shopPending,
    shopLoading, shopBusy, setShopBusy,
    shopSearch, setShopSearch, shopCat, setShopCat,
    geneTier, setGeneTier, geneSpecies, setGeneSpecies,
    eggShopCfg, embryoShopCfg, forgePrices,
    openPack, setOpenPack,
    shopCatCounts, shopCatChips, shopVisible, shopGroups,
    loadShop, loadShopOrders, doImport, doBuy,
  };
}
