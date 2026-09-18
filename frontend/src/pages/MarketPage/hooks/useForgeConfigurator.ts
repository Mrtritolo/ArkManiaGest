/**
 * useForgeConfigurator -- the egg / embryo shop.
 *
 * The price is per species (from the operator price list) plus the options:
 * one colour region, the gender choice, and each gene trait at its tier. The
 * level is fixed and the wild stats are rolled by the server, so there is
 * nothing else to configure.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  webShopApi,
  type WebShopForgeConfig, type WebShopForgePrice, type WebShopGene,
} from "../../../services/api";
import { extractError, type TFunc } from "../marketUtils";
import type { PendingBuy } from "./usePurchaseConfirm";
import type { ToastApi } from "../../../components/ui";

export type ForgeMode = "egg" | "embryo";

interface Args {
  eggShopCfg: WebShopForgeConfig | null;
  embryoShopCfg: WebShopForgeConfig | null;
  forgePrices: WebShopForgePrice[];
  shopGenes: WebShopGene[];
  setShopBusy: (key: string | null) => void;
  toast: ToastApi;
  loadWallet: () => Promise<void>;
  loadShopOrders: () => Promise<void>;
  requestBuy: (buy: PendingBuy) => void;
  t: TFunc;
}

const COLOR_REGIONS = 6;

export function useForgeConfigurator({
  eggShopCfg, embryoShopCfg, forgePrices, shopGenes,
  setShopBusy, toast, loadWallet, loadShopOrders, requestBuy, t,
}: Args) {
  const [mode, setMode] = useState<ForgeMode>("egg");
  const [species, setSpecies] = useState("");
  const [colors, setColors] = useState<number[]>(() => Array(COLOR_REGIONS).fill(0));
  const [gender, setGender] = useState(-1);
  const [traits, setTraits] = useState<string[]>([]);
  const [traitPick, setTraitPick] = useState("");
  const [traitTier, setTraitTier] = useState(0);

  // Forge mode follows the configs: with only one of the two shops enabled,
  // defaulting to "egg" showed the embryo-only shop as disabled.
  useEffect(() => {
    if (eggShopCfg?.enabled && !embryoShopCfg?.enabled) setMode("egg");
    else if (!eggShopCfg?.enabled && embryoShopCfg?.enabled) setMode("embryo");
  }, [eggShopCfg, embryoShopCfg]);

  const cfg = mode === "egg" ? eggShopCfg : embryoShopCfg;

  const speciesRows = useMemo(() => forgePrices.filter(r =>
    mode === "egg"
      ? r.egg_enabled && r.egg_price > 0
      : r.embryo_enabled && r.embryo_price > 0), [forgePrices, mode]);

  const selected = speciesRows.find(r => r.blueprint === species) || null;

  const price = useMemo(() => {
    if (!cfg || !selected) return 0;
    const speciesPrice = mode === "egg" ? selected.egg_price : selected.embryo_price;
    const colorsSet = colors.filter(c => c > 0).length;
    const traitPrice = traits.reduce((sum, tr) => {
      const m = /^(.+)\[([0-2])\]$/.exec(tr);
      const g = m && shopGenes.find(x => x.key === m[1]);
      return sum + (g ? (g.prices[String(Number(m![2]) + 1)] || 0) : 0);
    }, 0);
    return speciesPrice
      + colorsSet * cfg.price_per_color
      + (gender >= 0 ? cfg.price_gender_choice : 0)
      + traitPrice;
  }, [cfg, selected, mode, colors, gender, traits, shopGenes]);

  /**
   * Switching shop clears the species (the price lists differ) and trims the
   * traits: each shop has its own cap, and extra traits would be priced here
   * and then rejected with TOO_MANY_TRAITS.
   */
  const switchMode = useCallback((next: ForgeMode) => {
    const nextCfg = next === "egg" ? eggShopCfg : embryoShopCfg;
    setMode(next);
    setSpecies("");
    setTraits(p => p.slice(0, nextCfg?.max_traits ?? 0));
  }, [eggShopCfg, embryoShopCfg]);

  const setColor = useCallback((index: number, value: number) => {
    setColors(p => p.map((v, j) =>
      j === index ? Math.max(0, Math.min(255, value || 0)) : v));
  }, []);

  const addTrait = useCallback(() => {
    if (!traitPick || !cfg || traits.length >= cfg.max_traits) return;
    const entry = `${traitPick}[${traitTier}]`;
    setTraits(p => (p.includes(entry) ? p : [...p, entry]));
  }, [traitPick, traitTier, traits.length, cfg]);

  const removeTrait = useCallback((entry: string) => {
    setTraits(p => p.filter(x => x !== entry));
  }, []);

  /**
   * The colours, traits, gender and mode are snapshotted here, at click time:
   * the dialog runs `run` later, and editing the form meanwhile must not
   * change what is bought.
   */
  function buy() {
    if (!cfg || !selected) return;
    const bp = selected.blueprint, lbl = selected.label;
    const snapColors = [...colors], snapTraits = [...traits];
    const snapGender = gender, snapMode = mode;
    requestBuy({ label: lbl, price, run: async () => {
      setShopBusy("__forge");
      try {
        const r = await webShopApi.buy(snapMode,
          `${snapMode}:${lbl}`.slice(0, 128), 1, 1, bp,
          { stats: [], muts: [], colors: snapColors, traits: snapTraits, gender: snapGender });
        toast.success(t("market.shop.bought", { spent: r.data.spent }));
        await Promise.all([loadWallet(), loadShopOrders()]);
      } catch (e: unknown) {
        loadWallet();
        throw new Error(extractError(e, t("market.errors.buy"), t));
      } finally {
        setShopBusy(null);
      }
    }});
  }

  return {
    mode, switchMode, cfg, speciesRows, species, setSpecies, selected,
    colors, setColor, gender, setGender,
    traits, addTrait, removeTrait, traitPick, setTraitPick, traitTier, setTraitTier,
    price, buy,
  };
}
