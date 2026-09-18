/**
 * useAdminPrices -- the "Prices" tab: the gene price matrix (category x tier)
 * and the per-species price list of the egg / embryo shops.
 *
 * Reading the prices is allowed to any panel role; saving them is operator
 * work, which the shell enforces on the controls (and the backend on the
 * route).
 */
import { useCallback, useRef, useState } from "react";
import {
  webShopApi,
  type WebShopForgePrice, type WebShopGeneCategory, type WebShopGeneDino,
  type WebShopGenePriceEntry,
} from "../../../services/api";
import { extractError, type TFunc } from "../marketUtils";
import type { ToastApi } from "../../../components/ui";

interface Args {
  setLoadError: (message: string) => void;
  toast: ToastApi;
  loadShop: () => Promise<void>;
  shopGeneDinos: WebShopGeneDino[];
  t: TFunc;
}

export function useAdminPrices({ setLoadError, toast, loadShop, shopGeneDinos, t }: Args) {
  const tRef = useRef(t);
  tRef.current = t;

  const [cats, setCats] = useState<WebShopGeneCategory[]>([]);
  const [matrix, setMatrix] = useState<Record<string, string>>({});
  const [forgeRows, setForgeRows] = useState<WebShopForgePrice[]>([]);
  const [speciesPick, setSpeciesPick] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await webShopApi.adminPrices();
      setCats(r.data.gene_categories || []);
      const m: Record<string, string> = {};
      for (const e of r.data.gene_matrix || [])
        m[`${e.category}:${e.tier}`] = String(e.price);
      setMatrix(m);
      setForgeRows(r.data.forge_prices || []);
    } catch (e: unknown) {
      setLoadError(extractError(e, tRef.current("market.errors.loadPrices"), tRef.current));
    }
  }, [setLoadError]);

  async function saveGenes() {
    setBusy(true);
    try {
      const entries: WebShopGenePriceEntry[] = [];
      for (const [k, v] of Object.entries(matrix)) {
        const val = String(v).trim();
        if (val === "") continue;
        const [category, tier] = k.split(":");
        entries.push({ category, tier: Number(tier),
                       price: Math.max(0, Number(val) || 0) });
      }
      await webShopApi.saveGenePrices(entries);
      toast.success(t("market.prices.saved"));
      await Promise.all([load(), loadShop()]);
    } catch (e: unknown) {
      toast.error(extractError(e, t("market.errors.savePrices"), t));
    } finally {
      setBusy(false);
    }
  }

  async function saveForge() {
    setBusy(true);
    try {
      await webShopApi.saveForgePrices(forgeRows);
      toast.success(t("market.prices.saved"));
      await Promise.all([load(), loadShop()]);
    } catch (e: unknown) {
      toast.error(extractError(e, t("market.errors.savePrices"), t));
    } finally {
      setBusy(false);
    }
  }

  const patchRow = (bp: string, patch: Partial<WebShopForgePrice>) =>
    setForgeRows(p => p.map(r => (r.blueprint === bp ? { ...r, ...patch } : r)));

  const addSpecies = () => {
    const d = shopGeneDinos.find(x => x.blueprint === speciesPick);
    if (!d) return;
    setForgeRows(p => [...p, {
      blueprint: d.blueprint, label: d.label,
      egg_price: 0, embryo_price: 0,
      egg_enabled: true, embryo_enabled: true,
    }]);
    setSpeciesPick("");
  };

  const removeSpecies = (bp: string) =>
    setForgeRows(p => p.filter(x => x.blueprint !== bp));

  return {
    cats, matrix, setMatrix, forgeRows, speciesPick, setSpeciesPick, busy,
    load, saveGenes, saveForge, patchRow, addSpecies, removeSpecies,
  };
}
