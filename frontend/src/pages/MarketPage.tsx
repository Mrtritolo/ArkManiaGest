/**
 * MarketPage.tsx — ArkMania Marketplace dashboard (Phase 8).
 *
 * Two render modes (mirroring PlayerDashboardPage):
 *   - standalone (Discord-only player): full-canvas wrapper.
 *   - embedded (admin sidebar route): pl-page wrapper, sidebar visible.
 *
 * Three tabs:
 *   1. Browse   -- listed items, search/filter, Buy button per row.
 *   2. My items -- my drafts (set price + list), my listings (cancel),
 *                  my pending claims, my completed sales.
 *   3. History  -- recent transactions where I'm buyer or seller.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Loader2, AlertCircle, RefreshCw, ShoppingBag, Coins,
  Package, History, Search, Tag, X, Save, Ban,
  Store, Dna, Inbox, ChevronDown, ChevronUp, Egg,
} from "lucide-react";
import {
  marketApi, webShopApi,
  type MarketListedItem, type MarketMyItem, type MarketWallet,
  type MarketTransaction,
  type WebShopItem, type WebShopGene, type WebShopGeneDino,
  type WebShopOrder, type WebShopForgeConfig, type WebShopForgePrice,
  type WebShopGenePriceEntry, type WebShopGeneCategory,
} from "../services/api";
import { shopEntryThumbCandidates } from "../utils/shopImage";
import { ShopFallbackIcon } from "../utils/shopFallbackIcon";
import { arkItemDisplayName, arkItemThumbUrl } from "../utils/arkItem";
import type { AuthUser } from "../types";

/**
 * Ordine in cui le categorie del catalogo compaiono nella vetrina.
 *
 * Gli slug li scrive l'import di ArkShop (SHOP_CATEGORIES in web_shop.py);
 * qui vive solo l'ordine di lettura -- prima cio' che si compra per fare una
 * cosa (boss, equipaggiamento, dino), poi cio' che si compra per averlo.
 * "other" chiude sempre la lista: e' il segnale che una voce nuova del
 * catalogo aspetta una categoria.
 */
const SHOP_CATEGORY_ORDER = [
  "boss", "armor", "dino", "resources", "tools", "structures", "other",
];

type TabKey =
  | "browse" | "mine" | "history"
  | "shop" | "genes" | "forge" | "orders" | "prices";

interface MarketPageProps {
  embedded?: boolean;
  /** Solo nella variante dentro il pannello admin: serve per il catalogo. */
  currentUser?: AuthUser | null;
}

function fmtRelative(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const diff = Date.now() - d.getTime();
  const abs = Math.abs(diff);
  let label: string;
  if (abs < 60_000)             label = "< 1m";
  else if (abs < 3_600_000)     label = `${Math.floor(abs / 60_000)}m`;
  else if (abs < 86_400_000)    label = `${Math.floor(abs / 3_600_000)}h`;
  else if (abs < 86_400_000*30) label = `${Math.floor(abs / 86_400_000)}g`;
  else return d.toLocaleDateString();
  return diff >= 0 ? `${label} fa` : `tra ${label}`;
}

function shortBp(bp: string): string {
  // Path style: /Game/.../PrimalItem_X.PrimalItem_X -> "PrimalItem_X"
  const last = bp.split(/[/.]/).pop() || bp;
  return last.length > 60 ? last.slice(0, 57) + "…" : last;
}

function extractError(err: unknown, fallback: string): string {
  const code = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  if (typeof code === "string") {
    // Map known machine codes to user text
    const map: Record<string, string> = {
      INSUFFICIENT_FUNDS:    "Saldo insufficiente.",
      ITEM_NOT_AVAILABLE:    "Item non più disponibile.",
      INVALID_STATE:         "Operazione non valida nello stato corrente.",
      NOT_OWNER:             "Solo il proprietario può farlo.",
      ITEM_NOT_FOUND:        "Item non trovato.",
      CANNOT_BUY_OWN_ITEM:   "Non puoi acquistare un tuo item.",
    };
    return map[code] ?? code;
  }
  return (err as { message?: string })?.message ?? fallback;
}

export default function MarketPage({ embedded = false, currentUser }: MarketPageProps) {
  const isAdmin = currentUser?.role === "admin";
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabKey>("browse");

  // --- Shop web (ArkShop + GeneShop). Tenuto separato dallo stato del
  // marketplace: sono due negozi diversi che condividono solo la pagina.
  const [shopItems, setShopItems] = useState<WebShopItem[]>([]);
  const [shopGenes, setShopGenes] = useState<WebShopGene[]>([]);
  const [shopOrders, setShopOrders] = useState<WebShopOrder[]>([]);
  const [shopPending, setShopPending] = useState(0);
  const [shopLoading, setShopLoading] = useState(false);
  const [shopBusy, setShopBusy] = useState<string | null>(null);
  const [shopSearch, setShopSearch] = useState("");
  const [shopCat, setShopCat] = useState("");   // "" = tutte le categorie
  const [geneTier, setGeneTier] = useState<Record<string, number>>({});
  // La specie e' UNA per tutta la scheda, non una per tratto: si sceglie
  // prima il dino e poi il tratto, come si farebbe scansionando in gioco.
  const [shopGeneDinos, setShopGeneDinos] = useState<WebShopGeneDino[]>([]);
  const [geneSpecies, setGeneSpecies] = useState("");

  // Shop uova / embrioni (configuratore "forge")
  const [eggShopCfg, setEggShopCfg] = useState<WebShopForgeConfig | null>(null);
  const [embryoShopCfg, setEmbryoShopCfg] = useState<WebShopForgeConfig | null>(null);
  const [forgePrices, setForgePrices] = useState<WebShopForgePrice[]>([]);
  const [forgeMode, setForgeMode] = useState<"egg" | "embryo">("egg");
  const [forgeSpecies, setForgeSpecies] = useState("");
  const [forgeColors, setForgeColors] = useState<number[]>([0, 0, 0, 0, 0, 0]);
  const [forgeGender, setForgeGender] = useState(-1);
  const [forgeTraits, setForgeTraits] = useState<string[]>([]);
  const [forgeTraitPick, setForgeTraitPick] = useState("");
  const [forgeTraitTier, setForgeTraitTier] = useState(0);

  // Tab admin "Prezzi"
  const [adminCats, setAdminCats] = useState<WebShopGeneCategory[]>([]);
  const [adminMatrix, setAdminMatrix] = useState<Record<string, string>>({});
  const [adminForgeRows, setAdminForgeRows] = useState<WebShopForgePrice[]>([]);
  const [adminSpeciesPick, setAdminSpeciesPick] = useState("");
  const [adminBusy, setAdminBusy] = useState(false);
  // Quale pacchetto ha il dettaglio aperto. Uno alla volta: aprirne piu' di
  // uno trasforma la griglia in un muro di liste.
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
    } catch (e: any) {
      setError(e.response?.data?.detail || String(e));
    } finally {
      setShopLoading(false);
    }
  }, []);

  const loadShopOrders = useCallback(async () => {
    try {
      const r = await webShopApi.orders();
      setShopOrders(r.data.orders || []);
      setShopPending(r.data.pending || 0);
    } catch { /* il conteggio in coda e' un di piu', non un errore da mostrare */ }
  }, []);

  const loadAdminPrices = useCallback(async () => {
    try {
      const r = await webShopApi.adminPrices();
      setAdminCats(r.data.gene_categories || []);
      const m: Record<string, string> = {};
      for (const e of r.data.gene_matrix || [])
        m[`${e.category}:${e.tier}`] = String(e.price);
      setAdminMatrix(m);
      setAdminForgeRows(r.data.forge_prices || []);
    } catch (e: any) {
      setError(e.response?.data?.detail || String(e));
    }
  }, []);

  /** Admin: importa il catalogo ArkShop nella vetrina web. */
  async function doImport() {
    setShopBusy("__import"); setError(""); setSuccess("");
    try {
      const r = await webShopApi.importArkshop();
      const skipped = Object.entries(r.data.skipped || {})
        .map(([k, v]) => `${k}: ${v}`).join(", ");
      setSuccess(t("market.shop.imported", {
        n: r.data.imported, skipped: skipped || "-" }));
      await loadShop();
    } catch (e: any) {
      setError(e.response?.data?.detail || String(e));
    } finally {
      setShopBusy(null);
    }
  }

  // Conferma acquisto: modale dedicato (non window.confirm) che mostra il
  // saldo attuale e quello dopo l'acquisto. `run` e' l'acquisto vero, gia'
  // completo della propria gestione errori.
  const [pendingBuy, setPendingBuy] = useState<{
    label: string; price: number; run: () => Promise<void>;
  } | null>(null);
  const [pendingBusy, setPendingBusy] = useState(false);

  const confirmPendingBuy = async () => {
    if (!pendingBuy) return;
    setPendingBusy(true);
    try {
      await pendingBuy.run();
    } finally {
      setPendingBusy(false);
      setPendingBuy(null);
    }
  };

  /**
   * Compra e mette in coda. Ricarica il portafoglio subito dopo: i punti
   * sono la cosa che l'utente controlla per capire se e' andata a buon fine.
   */
  function doBuy(kind: "item" | "dino" | "gene", key: string,
                 label: string, price: number, tier = 1,
                 species = "") {
    setPendingBuy({ label, price, run: async () => {
      setShopBusy(key); setError(""); setSuccess("");
      try {
        const r = await webShopApi.buy(kind, key, 1, tier, species);
        setSuccess(t("market.shop.bought", { spent: r.data.spent }));
        await Promise.all([loadWallet(), loadShopOrders()]);
      } catch (e: any) {
        setError(e.response?.data?.detail || String(e));
      } finally {
        setShopBusy(null);
      }
    }});
  }

  const [error, setError]     = useState("");
  const [success, setSuccess] = useState("");

  // Browse
  const [listed, setListed]       = useState<MarketListedItem[]>([]);
  const [listedTotal, setListedTotal] = useState(0);
  const [listedLoading, setListedLoading] = useState(true);
  const [searchBp, setSearchBp]   = useState("");
  const [sort, setSort]           = useState<"newest" | "price_asc" | "price_desc">("newest");

  // My items
  const [myItems, setMyItems] = useState<MarketMyItem[]>([]);
  const [myLoading, setMyLoading] = useState(false);
  const [priceInput, setPriceInput] = useState<Record<number, string>>({});

  // Wallet
  const [wallet, setWallet] = useState<MarketWallet | null>(null);

  // History
  const [history, setHistory] = useState<MarketTransaction[]>([]);
  const [histLoading, setHistLoading] = useState(false);

  const loadListed = useCallback(async () => {
    setListedLoading(true);
    setError("");
    try {
      const res = await marketApi.listed({
        limit: 100,
        blueprint: searchBp || undefined,
        sort,
      });
      setListed(res.data.items);
      setListedTotal(res.data.total);
    } catch (err) {
      setError(extractError(err, t("market.errors.loadListed")));
    } finally {
      setListedLoading(false);
    }
  }, [searchBp, sort, t]);

  const loadWallet = useCallback(async () => {
    try {
      const res = await marketApi.myWallet();
      setWallet(res.data);
    } catch {
      // 401/403 -- silently null (we're an admin without a Discord link)
      setWallet(null);
    }
  }, []);

  const loadMyItems = useCallback(async () => {
    setMyLoading(true);
    try {
      const res = await marketApi.myItems();
      setMyItems(res.data);
    } catch (err) {
      setError(extractError(err, t("market.errors.loadMine")));
    } finally {
      setMyLoading(false);
    }
  }, [t]);

  const loadHistory = useCallback(async () => {
    setHistLoading(true);
    try {
      const res = await marketApi.myTransactions();
      setHistory(res.data.transactions);
    } catch (err) {
      setError(extractError(err, t("market.errors.loadHistory")));
    } finally {
      setHistLoading(false);
    }
  }, [t]);

  useEffect(() => { loadListed(); loadWallet(); }, [loadListed, loadWallet]);
  useEffect(() => {
    if (tab === "mine") loadMyItems();
    if (tab === "history") loadHistory();
    if (tab === "shop" || tab === "genes" || tab === "forge") loadShop();
    if (tab === "orders") loadShopOrders();
    if (tab === "prices") { loadShop(); loadAdminPrices(); }
  }, [tab, loadMyItems, loadHistory, loadShop, loadShopOrders]);

  // Il numero di acquisti da ritirare va saputo appena si apre la pagina:
  // e' l'unica cosa che richiede un'azione in gioco.
  useEffect(() => { loadShopOrders(); }, [loadShopOrders]);

  // Auto-clear toasts.
  useEffect(() => {
    if (!success) return;
    const x = setTimeout(() => setSuccess(""), 3000);
    return () => clearTimeout(x);
  }, [success]);

  function handleBuy(item: MarketListedItem) {
    setPendingBuy({
      label: arkItemDisplayName(item.blueprint),
      price: item.price,
      run: async () => {
        try {
          const res = await marketApi.buy(item.id);
          setSuccess(t("market.bought", {
            b: res.data.new_balance,
          }));
          setListed(prev => prev.filter(i => i.id !== item.id));
          setListedTotal(t => t - 1);
          loadWallet();
        } catch (err) {
          setError(extractError(err, t("market.errors.buy")));
        }
      },
    });
  }

  async function handleList(itemId: number) {
    const raw = priceInput[itemId];
    const price = parseInt(raw || "", 10);
    if (!price || price <= 0) {
      setError(t("market.errors.priceRequired"));
      return;
    }
    try {
      await marketApi.listForSale(itemId, price);
      setSuccess(t("market.listed"));
      setPriceInput(p => ({ ...p, [itemId]: "" }));
      loadMyItems();
      loadListed();
    } catch (err) {
      setError(extractError(err, t("market.errors.list")));
    }
  }

  async function handleCancel(itemId: number) {
    if (!confirm(t("market.confirmCancel"))) return;
    try {
      await marketApi.cancel(itemId);
      setSuccess(t("market.cancelled"));
      loadMyItems();
      loadListed();
    } catch (err) {
      setError(extractError(err, t("market.errors.cancel")));
    }
  }

  // ── Catalogo dello shop: ricerca, filtro categoria, raggruppamento ────
  //
  // La ricerca resta globale (cerca in tutte le categorie, non solo in
  // quella selezionata) perche' chi scrive "flak" vuole trovare il flak,
  // non scoprire di essere nella sezione sbagliata.

  /** Quante voci ha ogni categoria, prima del filtro di categoria. */
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

  /** Voci che passano ricerca + categoria. */
  const shopVisible = useMemo(() => {
    const q = shopSearch.trim().toLowerCase();
    return shopItems.filter(i =>
      (!q || i.label.toLowerCase().includes(q)) &&
      (!shopCat || (i.category || "other") === shopCat));
  }, [shopItems, shopSearch, shopCat]);

  /** [categoria, voci][] nell'ordine di lettura; le vuote non compaiono. */
  const shopGroups = useMemo(() => {
    const by = new Map<string, typeof shopVisible>();
    for (const i of shopVisible) {
      const c = i.category || "other";
      const bucket = by.get(c);
      if (bucket) bucket.push(i);
      else by.set(c, [i]);
    }
    // Una categoria sconosciuta (slug nuovo lato backend) non sparisce:
    // finisce in fondo, dopo quelle note.
    const known = SHOP_CATEGORY_ORDER.filter(c => by.has(c));
    const rest = [...by.keys()].filter(c => !SHOP_CATEGORY_ORDER.includes(c)).sort();
    return [...known, ...rest].map(c => [c, by.get(c)!] as const);
  }, [shopVisible]);

  // Stats grouped per status -- shown in the My-Items tab
  const myStats = useMemo(() => {
    const out = { draft: 0, listed: 0, sold: 0, claimed: 0 };
    for (const it of myItems) if (it.role === "owner") out[it.status as keyof typeof out]++;
    return out;
  }, [myItems]);

  // ── Layout shell ──────────────────────────────────────────────────────

  const Wrapper = embedded
    ? ({ children }: { children: React.ReactNode }) => (
        <div className="pl-page">
          <div className="pl-header">
            <div>
              <h1 className="pl-title" style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <ShoppingBag size={20} />{" "}
                {t("market.title")}
              </h1>
              <p className="pl-subtitle">
                {t("market.subtitle")}
              </p>
            </div>
            {wallet && (
              <div className="pl-chip" title={t("market.pointsHint")}
                style={{ background: "#8fce5a15", color: "#8fce5a", borderColor: "#8fce5a40", fontSize: "0.85rem" }}>
                <Coins size={11} /> {wallet.balance.toLocaleString()}
              </div>
            )}
          </div>
          {children}
        </div>
      )
    : ({ children }: { children: React.ReactNode }) => (
        <div style={{
          minHeight: "100vh",
          background: "var(--bg, #f5f5f7)",
          padding: "clamp(0.75rem, 3vw, 1.5rem)",
        }}>
          <div style={{ maxWidth: 1100, margin: "0 auto" }}>
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              gap: "1rem", padding: "0.8rem 1.1rem",
              background: "linear-gradient(135deg, #8fce5a 0%, #047857 100%)",
              color: "#fff", borderRadius: 12,
              boxShadow: "0 4px 12px rgba(22, 163, 74, 0.25)",
              marginBottom: "1rem",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                <ShoppingBag size={28} />
                <div>
                  <div style={{ fontSize: "1.2rem", fontWeight: 700 }}>
                    {t("market.title")}
                  </div>
                  <div style={{ fontSize: "0.78rem", opacity: 0.9 }}>
                    {t("market.subtitle")}
                  </div>
                </div>
              </div>
              {wallet && (
                <div title={t("market.pointsHint")} style={{
                  display: "flex", alignItems: "center", gap: "0.4rem",
                  padding: "0.4rem 0.8rem",
                  background: "#ffffff22", border: "1px solid #ffffff44",
                  borderRadius: 99, fontSize: "1.1rem", fontWeight: 700,
                }}>
                  <Coins size={16} /> {wallet.balance.toLocaleString()}
                </div>
              )}
            </div>
            {children}
          </div>
        </div>
      );

  return (
    <Wrapper>
      <>
        {/* Tab switcher */}
        <div style={{
          display: "flex", gap: "0.4rem", marginBottom: "1rem",
          borderBottom: "1px solid var(--border)", paddingBottom: "0.4rem",
          flexWrap: "wrap",
        }}>
          <TabBtn active={tab === "browse"}  onClick={() => setTab("browse")}
                  icon={<Search size={14} />}
                  label={t("market.tab.browse")} />
          <TabBtn active={tab === "mine"}    onClick={() => setTab("mine")}
                  icon={<Package size={14} />}
                  label={t("market.tab.mine")} />
          <TabBtn active={tab === "history"} onClick={() => setTab("history")}
                  icon={<History size={14} />}
                  label={t("market.tab.history")} />
          {/* Il negozio del server e il mercatino fra giocatori vivono nella
              stessa pagina ma non sono la stessa cosa: separati da un divisore
              perche' qui i punti sono quelli di ArkShop e non c'e' un venditore
              dall'altra parte. */}
          <span style={{ width: 1, alignSelf: "stretch", background: "var(--border)", margin: "0 0.3rem" }} />
          <TabBtn active={tab === "shop"} onClick={() => setTab("shop")}
                  icon={<Store size={14} />}
                  label={t("market.tab.shop")} />
          <TabBtn active={tab === "genes"} onClick={() => setTab("genes")}
                  icon={<Dna size={14} />}
                  label={t("market.tab.genes")} />
          {(eggShopCfg?.enabled || embryoShopCfg?.enabled) && (
            <TabBtn active={tab === "forge"} onClick={() => setTab("forge")}
                    icon={<Egg size={14} />}
                    label={t("market.tab.forge")} />
          )}
          {isAdmin && (
            <TabBtn active={tab === "prices"} onClick={() => setTab("prices")}
                    icon={<Coins size={14} />}
                    label={t("market.tab.prices")} />
          )}
          <TabBtn active={tab === "orders"} onClick={() => setTab("orders")}
                  icon={<Inbox size={14} />}
                  label={shopPending > 0
                    ? `${t("market.tab.orders")} (${shopPending})`
                    : t("market.tab.orders")} />
        </div>

        {shopPending > 0 && tab !== "orders" && (
          <div className="alert alert-info" style={{ marginBottom: "0.5rem" }}>
            <Inbox size={14} /> {t("market.shop.pendingHint", { n: shopPending })}
          </div>
        )}

        {error && (
          <div className="alert alert-error" style={{ marginBottom: "0.5rem" }}>
            <AlertCircle size={14} /> {error}
            <button onClick={() => setError("")} style={{
              marginLeft: "auto", background: "transparent", border: 0, cursor: "pointer", color: "inherit",
            }}><X size={14} /></button>
          </div>
        )}
        {success && (
          <div className="alert alert-success" style={{ marginBottom: "0.5rem" }}>
            {success}
          </div>
        )}

        {/* Modale di conferma acquisto: prezzo, saldo attuale e saldo dopo.
            --bg-popover, non --bg-card: la seconda e' traslucida e sul tema
            scuro un overlay ci si legge male (fix noto 3.5.5). */}
        {pendingBuy && (() => {
          const balance = wallet?.balance ?? null;
          const after = balance !== null ? balance - pendingBuy.price : null;
          const short = after !== null && after < 0;
          return (
            <div
              style={{
                position: "fixed", inset: 0, zIndex: 1000,
                background: "rgba(0, 0, 0, 0.45)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
              onClick={() => { if (!pendingBusy) setPendingBuy(null); }}>
              <div
                style={{
                  background: "var(--bg-popover)", borderRadius: 10,
                  border: "1px solid var(--border)",
                  boxShadow: "0 12px 40px rgba(0, 0, 0, 0.35)",
                  padding: "1.1rem 1.3rem", width: "min(420px, 92vw)",
                }}
                onClick={e => e.stopPropagation()}>
                <div style={{ fontWeight: 700, fontSize: "1rem", marginBottom: "0.3rem" }}>
                  {t("market.buyModal.title")}
                </div>
                <div style={{ fontSize: "0.9rem", marginBottom: "0.8rem" }}>
                  {pendingBuy.label}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem",
                              fontSize: "0.85rem", marginBottom: "0.9rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-secondary)" }}>{t("market.buyModal.price")}</span>
                    <span style={{ fontWeight: 700 }}>
                      <Coins size={13} /> {pendingBuy.price}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-secondary)" }}>{t("market.buyModal.current")}</span>
                    <span style={{ fontWeight: 600 }}>{balance !== null ? balance : "—"}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between",
                                borderTop: "1px solid var(--border)", paddingTop: "0.3rem" }}>
                    <span style={{ color: "var(--text-secondary)" }}>{t("market.buyModal.after")}</span>
                    <span style={{ fontWeight: 700,
                                   color: short ? "var(--danger)" : "var(--success)" }}>
                      {after !== null ? after : "—"}
                    </span>
                  </div>
                </div>
                {short && (
                  <div className="alert alert-error" style={{ marginBottom: "0.7rem" }}>
                    {t("market.buyModal.insufficient")}
                  </div>
                )}
                <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                  <button className="btn btn-secondary btn-sm"
                    disabled={pendingBusy}
                    onClick={() => setPendingBuy(null)}>
                    {t("market.buyModal.cancel")}
                  </button>
                  <button className="btn btn-primary btn-sm"
                    disabled={pendingBusy || short}
                    onClick={confirmPendingBuy}>
                    {pendingBusy
                      ? <Loader2 size={12} className="pl-spin" />
                      : <ShoppingBag size={12} />} {t("market.buyModal.confirm")}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* TAB: Shop del server (oggetti e dino importati da ArkShop) */}
        {tab === "shop" && (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: "0.7rem" }}>
              <input
                className="form-input"
                placeholder={t("market.shop.searchPh")}
                value={shopSearch}
                onChange={e => setShopSearch(e.target.value)}
                style={{ flex: 1, minWidth: 0 }}
              />
              {/* Solo admin: riempie la vetrina dalla config di ArkShop. Sta
                  qui e non in una pagina di impostazioni perche' e' il posto
                  dove ci si accorge che la vetrina e' vuota. */}
              {isAdmin && (
                <button className="btn btn-secondary btn-sm"
                  disabled={shopBusy !== null}
                  title={t("market.shop.importHint")}
                  onClick={doImport}>
                  {shopBusy === "__import"
                    ? <Loader2 size={13} className="pl-spin" />
                    : <RefreshCw size={13} />} {t("market.shop.import")}
                </button>
              )}
            </div>
            {/* Filtro per categoria. I conteggi seguono la ricerca, cosi'
                una categoria che la ricerca ha svuotato si vede subito. */}
            {shopItems.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: "0.7rem" }}>
                <CategoryChip active={!shopCat} onClick={() => setShopCat("")}
                  label={t("market.shop.catAll")} count={shopVisible.length} />
                {SHOP_CATEGORY_ORDER.filter(c => shopCatCounts[c]).map(c => (
                  <CategoryChip key={c} active={shopCat === c}
                    onClick={() => setShopCat(shopCat === c ? "" : c)}
                    label={t(`market.shop.cat.${c}`, { defaultValue: c })} count={shopCatCounts[c]} />
                ))}
              </div>
            )}
            {shopLoading ? (
              <div style={{ padding: "1rem", color: "var(--text-muted)" }}>
                <Loader2 size={14} className="pl-spin" /> {t("common.loading")}
              </div>
            ) : shopItems.length === 0 ? (
              <div className="alert alert-info">{t("market.shop.emptyItems")}</div>
            ) : shopVisible.length === 0 ? (
              <div className="alert alert-info">{t("market.shop.noMatch")}</div>
            ) : (
              <>
              {shopGroups.map(([cat, items]) => (
                <section key={cat} style={{ marginBottom: "1.1rem" }}>
                  <h3 style={{
                    display: "flex", alignItems: "baseline", gap: 8,
                    fontSize: "0.78rem", fontWeight: 700, textTransform: "uppercase",
                    letterSpacing: 0.6, color: "var(--text-muted)",
                    margin: "0 0 0.45rem", paddingBottom: "0.3rem",
                    borderBottom: "1px solid var(--border)",
                  }}>
                    {t(`market.shop.cat.${cat}`, { defaultValue: cat })}
                    <span style={{ fontWeight: 500 }}>{items.length}</span>
                  </h3>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "0.6rem" }}>
                    {items.map(i => {
                    const isPack = i.line_count > 1;
                    const open = openPack === i.key;
                    return (
                    <div key={i.key} className="card" style={{ padding: "0.7rem" }}>
                      <div style={{ display: "flex", gap: 8 }}>
                        <ShopThumb entry={i} size={72} />
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>{i.label}</div>
                          <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                            {i.kind === "dino"
                              ? t("market.shop.dinoLevel", { lvl: i.dino_level })
                              : isPack
                                ? t("market.shop.pieces", { n: i.line_count })
                                : `x${i.quantity}`}
                            {i.is_blueprint ? " · BP" : ""}
                          </div>
                        </div>
                      </div>
                      {i.kind === "dino" && (
                        <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", margin: "6px 0" }}>
                          {t("market.shop.dinoInPod")}
                        </div>
                      )}
                      {/* Il contenuto del pacchetto: sta chiuso perche' un kit
                          da 31 righe seppellirebbe la griglia, ma e' a un clic
                          perche' comprare senza sapere cosa c'e' dentro non e'
                          comprare. */}
                      {isPack && (
                        <button className="btn btn-ghost btn-sm"
                          style={{ marginTop: 6, padding: "1px 4px" }}
                          onClick={() => setOpenPack(open ? null : i.key)}>
                          {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                          {open ? t("market.shop.hideContent") : t("market.shop.showContent")}
                        </button>
                      )}
                      {isPack && open && (
                        <div style={{
                          maxHeight: 190, overflowY: "auto", marginTop: 4,
                          borderTop: "1px solid var(--border)", paddingTop: 4,
                        }}>
                          {i.lines.map((ln, idx) => (
                            <div key={idx} style={{
                              display: "flex", alignItems: "center", gap: 6,
                              fontSize: "0.72rem", padding: "1px 0",
                            }}>
                              <LineThumb blueprint={ln.blueprint} />
                              <span style={{ flex: 1, minWidth: 0, overflow: "hidden",
                                             textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {arkItemDisplayName(ln.blueprint)}
                              </span>
                              <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
                                x{ln.amount}
                              </span>
                              {ln.is_blueprint && (
                                <span style={{ fontSize: "0.62rem", color: "var(--accent)" }}>BP</span>
                              )}
                              {ln.quality > 0 && (
                                <span style={{ fontSize: "0.62rem", color: "var(--text-muted)" }}>
                                  Q{ln.quality}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                        <span style={{ fontFamily: "var(--font-mono)", color: "var(--accent)" }}>
                          <Coins size={12} /> {i.price}
                        </span>
                        <button className="btn btn-primary btn-sm" style={{ marginLeft: "auto" }}
                          disabled={shopBusy !== null}
                          onClick={() => doBuy(i.kind, i.key, i.label, i.price)}>
                          {shopBusy === i.key
                            ? <Loader2 size={12} className="pl-spin" />
                            : <ShoppingBag size={12} />} {t("market.shop.buy")}
                        </button>
                      </div>
                    </div>
                    );
                    })}
                  </div>
                </section>
              ))}
              </>
            )}
          </>
        )}

        {/* TAB: GeneShop */}
        {tab === "genes" && (
          <>
            <input
              className="form-input"
              placeholder={t("market.shop.searchPh")}
              value={shopSearch}
              onChange={e => setShopSearch(e.target.value)}
              style={{ marginBottom: "0.7rem", width: "100%" }}
            />
            {shopLoading ? (
              <div style={{ padding: "1rem", color: "var(--text-muted)" }}>
                <Loader2 size={14} className="pl-spin" /> {t("common.loading")}
              </div>
            ) : shopGenes.length === 0 ? (
              <div className="alert alert-info">{t("market.shop.emptyGenes")}</div>
            ) : (
              <>
              {/* Specie prima del tratto: e' l'ordine con cui si ragiona in
                  gioco, e vale per tutta la scheda perche' un acquisto e'
                  "questo tratto, prelevato da questa specie". */}
              {shopGeneDinos.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 8,
                              marginBottom: "0.6rem", flexWrap: "wrap" }}>
                  <label style={{ fontSize: "0.78rem" }}>
                    {t("market.shop.geneSpecies")}
                  </label>
                  <select className="form-input" style={{ maxWidth: 260 }}
                    value={geneSpecies}
                    onChange={e => setGeneSpecies(e.target.value)}>
                    <option value="">{t("market.shop.geneSpeciesNone")}</option>
                    {shopGeneDinos.map(d => (
                      <option key={d.blueprint} value={d.blueprint}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "0.6rem" }}>
                {shopGenes
                  .filter(g => !shopSearch ||
                    g.label.toLowerCase().includes(shopSearch.toLowerCase()) ||
                    g.category.toLowerCase().includes(shopSearch.toLowerCase()))
                  .map(g => {
                  const tier = geneTier[g.key] || 1;
                  const price = g.prices[String(tier)] ?? 0;
                  return (
                    <div key={g.key} className="card" style={{ padding: "0.7rem" }}>
                      <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>{g.label}</div>
                      <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>{g.category}</div>
                      <div style={{ fontSize: "0.72rem", margin: "6px 0" }}>{g.description}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <select className="form-input" style={{ width: 70, padding: "2px 4px" }}
                          value={tier}
                          onChange={e => setGeneTier(s => ({ ...s, [g.key]: Number(e.target.value) }))}>
                          <option value={1}>T1</option>
                          <option value={2}>T2</option>
                          <option value={3}>T3</option>
                        </select>
                        <span style={{ fontFamily: "var(--font-mono)", color: "var(--accent)" }}>
                          <Coins size={12} /> {price}
                        </span>
                        <button className="btn btn-primary btn-sm" style={{ marginLeft: "auto" }}
                          disabled={shopBusy !== null || price <= 0}
                          onClick={() => doBuy("gene", g.key, `${g.label} T${tier}`, price,
                                               tier, geneSpecies)}>
                          {shopBusy === g.key
                            ? <Loader2 size={12} className="pl-spin" />
                            : <ShoppingBag size={12} />} {t("market.shop.buy")}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              </>
            )}
            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: 8 }}>
              {t("market.shop.geneHint")}
            </div>
          </>
        )}

        {/* TAB: Forgia uova / embrioni — prezzo per specie (listino admin),
            livello fisso, stat selvatiche rollate dal server */}
        {tab === "forge" && (() => {
          const cfg = forgeMode === "egg" ? eggShopCfg : embryoShopCfg;
          const speciesRows = forgePrices.filter(r =>
            forgeMode === "egg"
              ? r.egg_enabled && r.egg_price > 0
              : r.embryo_enabled && r.embryo_price > 0);
          const selected = speciesRows.find(r => r.blueprint === forgeSpecies) || null;
          const speciesPrice = selected
            ? (forgeMode === "egg" ? selected.egg_price : selected.embryo_price)
            : 0;
          const colorsSet = forgeColors.filter(c => c > 0).length;
          const traitPrice = forgeTraits.reduce((sum, tr) => {
            const m = /^(.+)\[([0-2])\]$/.exec(tr);
            const g = m && shopGenes.find(x => x.key === m[1]);
            return sum + (g ? (g.prices[String(Number(m![2]) + 1)] || 0) : 0);
          }, 0);
          const price = cfg && selected
            ? speciesPrice
              + colorsSet * cfg.price_per_color
              + (forgeGender >= 0 ? cfg.price_gender_choice : 0)
              + traitPrice
            : 0;

          const doBuyForge = () => {
            if (!cfg || !selected) return;
            const bp = selected.blueprint, lbl = selected.label;
            const colors = [...forgeColors], traits = [...forgeTraits];
            const gender = forgeGender, mode = forgeMode;
            setPendingBuy({ label: lbl, price, run: async () => {
              setShopBusy("__forge"); setError(""); setSuccess("");
              try {
                const r = await webShopApi.buy(mode,
                  `${mode}:${lbl}`.slice(0, 128), 1, 1, bp,
                  { stats: [], muts: [], colors, traits, gender });
                setSuccess(t("market.shop.bought", { spent: r.data.spent }));
                await Promise.all([loadWallet(), loadShopOrders()]);
              } catch (e: any) {
                setError(e.response?.data?.detail || String(e));
              } finally {
                setShopBusy(null);
              }
            }});
          };

          return (
          <>
            {/* Selettore uovo / embrione */}
            <div style={{ display: "flex", gap: 8, marginBottom: "0.7rem" }}>
              {eggShopCfg?.enabled && (
                <button
                  className={forgeMode === "egg" ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"}
                  onClick={() => { setForgeMode("egg"); setForgeSpecies(""); }}>
                  <Egg size={13} /> {t("market.forge.eggMode")}
                </button>
              )}
              {embryoShopCfg?.enabled && (
                <button
                  className={forgeMode === "embryo" ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"}
                  onClick={() => { setForgeMode("embryo"); setForgeSpecies(""); }}>
                  <Dna size={13} /> {t("market.forge.embryoMode")}
                </button>
              )}
            </div>

            {!cfg?.enabled ? (
              <div className="alert alert-info">{t("market.forge.disabled")}</div>
            ) : speciesRows.length === 0 ? (
              <div className="alert alert-info">{t("market.forge.emptyList")}</div>
            ) : (
            <div className="card" style={{ padding: "0.9rem", maxWidth: 760 }}>
              {/* Specie (dal listino admin, col prezzo) */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "0.4rem", flexWrap: "wrap" }}>
                <label style={{ fontSize: "0.78rem", fontWeight: 600 }}>
                  {t("market.forge.species")}
                </label>
                <select className="form-input" style={{ maxWidth: 320 }}
                  value={forgeSpecies}
                  onChange={e => setForgeSpecies(e.target.value)}>
                  <option value="">{t("market.forge.speciesPick")}</option>
                  {speciesRows.map(r => (
                    <option key={r.blueprint} value={r.blueprint}>
                      {r.label} — {forgeMode === "egg" ? r.egg_price : r.embryo_price} pt
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginBottom: "0.7rem" }}>
                {t("market.forge.levelNote", { lvl: cfg.egg_level })}
                {forgeMode === "embryo" ? ` ${t("market.forge.embryoHint")}` : ""}
              </div>

              {/* Colori + sesso */}
              <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "0.7rem" }}>
                <div>
                  <div style={{ fontSize: "0.75rem", fontWeight: 600, marginBottom: 4 }}>
                    {t("market.forge.colors")} <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
                      ({t("market.forge.colorsHint")})
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: "0.3rem" }}>
                    {forgeColors.map((c, i) => (
                      <input key={i} type="number" min={0} max={255}
                        className="form-input" style={{ width: 58 }}
                        title={t("market.forge.colorRegion", { n: i })}
                        value={c}
                        onChange={e => setForgeColors(p => p.map((v, j) =>
                          j === i ? Math.max(0, Math.min(255, Number(e.target.value) || 0)) : v))} />
                    ))}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "0.75rem", fontWeight: 600, marginBottom: 4 }}>
                    {t("market.forge.gender")}
                  </div>
                  <select className="form-input" value={forgeGender}
                    onChange={e => setForgeGender(Number(e.target.value))}>
                    <option value={-1}>{t("market.forge.genderAny")}</option>
                    <option value={1}>{t("market.forge.genderMale")}</option>
                    <option value={2}>{t("market.forge.genderFemale")}</option>
                  </select>
                </div>
              </div>

              {/* Tratti genetici */}
              <div style={{ fontSize: "0.75rem", fontWeight: 600, marginBottom: 4 }}>
                {t("market.forge.traits")} <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
                  ({t("market.forge.traitsMax", { n: cfg.max_traits })})
                </span>
              </div>
              <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap", marginBottom: "0.4rem" }}>
                <select className="form-input" style={{ maxWidth: 240 }}
                  value={forgeTraitPick}
                  onChange={e => setForgeTraitPick(e.target.value)}>
                  <option value="">{t("market.forge.traitPick")}</option>
                  {shopGenes.map(g => (
                    <option key={g.key} value={g.key}>{g.label}</option>
                  ))}
                </select>
                <select className="form-input" value={forgeTraitTier}
                  onChange={e => setForgeTraitTier(Number(e.target.value))}>
                  {[0, 1, 2].map(tier => (
                    <option key={tier} value={tier}>T{tier + 1}</option>
                  ))}
                </select>
                <button className="btn btn-secondary btn-sm"
                  disabled={!forgeTraitPick
                    || forgeTraits.length >= cfg.max_traits}
                  onClick={() => {
                    const entry = `${forgeTraitPick}[${forgeTraitTier}]`;
                    if (!forgeTraits.includes(entry))
                      setForgeTraits(p => [...p, entry]);
                  }}>
                  {t("market.forge.traitAdd")}
                </button>
              </div>
              {forgeTraits.length > 0 && (
                <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
                  {forgeTraits.map(tr => (
                    <span key={tr} style={{
                      fontSize: "0.72rem", padding: "0.15rem 0.45rem",
                      borderRadius: 10, background: "var(--accent-50, #5cb89a12)",
                      display: "inline-flex", alignItems: "center", gap: 4,
                    }}>
                      {tr}
                      <button onClick={() => setForgeTraits(p => p.filter(x => x !== tr))}
                        style={{ background: "transparent", border: 0, cursor: "pointer", color: "inherit", padding: 0 }}>
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Prezzo + acquisto */}
              <div style={{ display: "flex", alignItems: "center", gap: "0.8rem", borderTop: "1px solid var(--border)", paddingTop: "0.7rem" }}>
                <span style={{ fontSize: "0.95rem", fontWeight: 700 }}>
                  <Coins size={14} /> {price} {t("market.forge.points")}
                </span>
                <button className="btn btn-primary" style={{ marginLeft: "auto" }}
                  disabled={shopBusy !== null || !selected}
                  onClick={doBuyForge}>
                  {shopBusy === "__forge"
                    ? <Loader2 size={13} className="pl-spin" />
                    : <ShoppingBag size={13} />} {t("market.forge.buy")}
                </button>
              </div>
              <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: 6 }}>
                {t("market.forge.claimHint")}
              </div>
            </div>
            )}
          </>
          );
        })()}

        {/* TAB ADMIN: gestione prezzi (matrice geni + listino specie forge) */}
        {tab === "prices" && isAdmin && (() => {
          const saveGenes = async () => {
            setAdminBusy(true); setError(""); setSuccess("");
            try {
              const entries: WebShopGenePriceEntry[] = [];
              for (const [k, v] of Object.entries(adminMatrix)) {
                const val = String(v).trim();
                if (val === "") continue;
                const [category, tier] = k.split(":");
                entries.push({ category, tier: Number(tier),
                               price: Math.max(0, Number(val) || 0) });
              }
              await webShopApi.saveGenePrices(entries);
              setSuccess(t("market.prices.saved"));
              await Promise.all([loadAdminPrices(), loadShop()]);
            } catch (e: any) {
              setError(e.response?.data?.detail || String(e));
            } finally {
              setAdminBusy(false);
            }
          };

          const saveForge = async () => {
            setAdminBusy(true); setError(""); setSuccess("");
            try {
              await webShopApi.saveForgePrices(adminForgeRows);
              setSuccess(t("market.prices.saved"));
              await Promise.all([loadAdminPrices(), loadShop()]);
            } catch (e: any) {
              setError(e.response?.data?.detail || String(e));
            } finally {
              setAdminBusy(false);
            }
          };

          const patchRow = (bp: string, patch: Partial<WebShopForgePrice>) =>
            setAdminForgeRows(p => p.map(r =>
              r.blueprint === bp ? { ...r, ...patch } : r));

          return (
          <>
            {/* Matrice prezzi geni: categoria x tier. Cella vuota = costo
                pubblicato dal plugin (mostrato come placeholder). */}
            <div className="card" style={{ padding: "0.9rem", marginBottom: "0.8rem" }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>
                {t("market.prices.geneTitle")}
              </div>
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginBottom: "0.6rem" }}>
                {t("market.prices.geneHint")}
              </div>
              {adminCats.length === 0 ? (
                <div className="alert alert-info">{t("market.prices.noCats")}</div>
              ) : (
              <table className="pl-table">
                <thead>
                  <tr>
                    <th>{t("market.prices.colCategory")}</th>
                    <th>T1</th><th>T2</th><th>T3</th>
                    <th>{t("market.prices.colTraits")}</th>
                  </tr>
                </thead>
                <tbody>
                  {adminCats.map(c => (
                    <tr key={c.category}>
                      <td style={{ fontWeight: 600 }}>{c.category}</td>
                      {[1, 2, 3].map(tier => (
                        <td key={tier}>
                          <input type="number" min={0}
                            className="form-input"
                            style={{ width: "100%", minWidth: 110, maxWidth: 160 }}
                            placeholder={String(c.fallback[String(tier)] ?? 0)}
                            value={adminMatrix[`${c.category}:${tier}`] ?? ""}
                            onChange={e => setAdminMatrix(p => ({
                              ...p, [`${c.category}:${tier}`]: e.target.value }))} />
                        </td>
                      ))}
                      <td style={{ color: "var(--text-muted)" }}>{c.traits}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              )}
              <div style={{ marginTop: "0.6rem" }}>
                <button className="btn btn-primary btn-sm" disabled={adminBusy}
                  onClick={saveGenes}>
                  {adminBusy ? <Loader2 size={12} className="pl-spin" /> : <Save size={12} />} {t("market.prices.saveGenes")}
                </button>
              </div>
            </div>

            {/* Listino specie uova / embrioni */}
            <div className="card" style={{ padding: "0.9rem" }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>
                {t("market.prices.forgeTitle")}
              </div>
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginBottom: "0.6rem" }}>
                {t("market.prices.forgeHint")}
              </div>
              <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", marginBottom: "0.6rem", flexWrap: "wrap" }}>
                <select className="form-input" style={{ maxWidth: 300 }}
                  value={adminSpeciesPick}
                  onChange={e => setAdminSpeciesPick(e.target.value)}>
                  <option value="">{t("market.prices.addSpeciesPick")}</option>
                  {shopGeneDinos
                    .filter(d => !adminForgeRows.some(r => r.blueprint === d.blueprint))
                    .map(d => (
                      <option key={d.blueprint} value={d.blueprint}>{d.label}</option>
                    ))}
                </select>
                <button className="btn btn-secondary btn-sm"
                  disabled={!adminSpeciesPick}
                  onClick={() => {
                    const d = shopGeneDinos.find(x => x.blueprint === adminSpeciesPick);
                    if (!d) return;
                    setAdminForgeRows(p => [...p, {
                      blueprint: d.blueprint, label: d.label,
                      egg_price: 0, embryo_price: 0,
                      egg_enabled: true, embryo_enabled: true,
                    }]);
                    setAdminSpeciesPick("");
                  }}>
                  {t("market.prices.addSpecies")}
                </button>
              </div>
              {adminForgeRows.length === 0 ? (
                <div className="alert alert-info">{t("market.prices.noSpecies")}</div>
              ) : (
              <table className="pl-table">
                <thead>
                  <tr>
                    <th>{t("market.prices.colSpecies")}</th>
                    <th>{t("market.prices.colEggPrice")}</th>
                    <th>{t("market.prices.colEggOn")}</th>
                    <th>{t("market.prices.colEmbryoPrice")}</th>
                    <th>{t("market.prices.colEmbryoOn")}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {adminForgeRows.map(r => (
                    <tr key={r.blueprint}>
                      <td style={{ fontWeight: 600 }}>{r.label}</td>
                      <td>
                        <input type="number" min={0} className="form-input"
                          style={{ width: "100%", minWidth: 110, maxWidth: 160 }}
                          value={r.egg_price}
                          onChange={e => patchRow(r.blueprint,
                            { egg_price: Math.max(0, Number(e.target.value) || 0) })} />
                      </td>
                      <td>
                        <input type="checkbox" checked={r.egg_enabled}
                          onChange={e => patchRow(r.blueprint, { egg_enabled: e.target.checked })} />
                      </td>
                      <td>
                        <input type="number" min={0} className="form-input"
                          style={{ width: "100%", minWidth: 110, maxWidth: 160 }}
                          value={r.embryo_price}
                          onChange={e => patchRow(r.blueprint,
                            { embryo_price: Math.max(0, Number(e.target.value) || 0) })} />
                      </td>
                      <td>
                        <input type="checkbox" checked={r.embryo_enabled}
                          onChange={e => patchRow(r.blueprint, { embryo_enabled: e.target.checked })} />
                      </td>
                      <td>
                        <button className="btn btn-danger btn-sm"
                          title={t("market.prices.removeSpecies")}
                          onClick={() => setAdminForgeRows(p =>
                            p.filter(x => x.blueprint !== r.blueprint))}>
                          <X size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              )}
              <div style={{ marginTop: "0.6rem", display: "flex", gap: "0.6rem", alignItems: "center" }}>
                <button className="btn btn-primary btn-sm" disabled={adminBusy}
                  onClick={saveForge}>
                  {adminBusy ? <Loader2 size={12} className="pl-spin" /> : <Save size={12} />} {t("market.prices.saveForge")}
                </button>
                <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                  {t("market.prices.saveHint")}
                </span>
              </div>
            </div>
          </>
          );
        })()}

        {/* TAB: I miei acquisti dallo shop */}
        {tab === "orders" && (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
              <button className="btn btn-ghost btn-sm" onClick={() => loadShopOrders()}>
                <RefreshCw size={13} /> {t("common.refresh")}
              </button>
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                {t("market.shop.claimHint")}
              </span>
            </div>
            {shopOrders.length === 0 ? (
              <div className="alert alert-info">{t("market.shop.noOrders")}</div>
            ) : (
              <table className="pl-table">
                <thead>
                  <tr>
                    <th>{t("market.shop.col.what")}</th>
                    <th>{t("market.shop.col.kind")}</th>
                    <th>{t("market.shop.col.price")}</th>
                    <th>{t("market.shop.col.status")}</th>
                    <th>{t("market.shop.col.when")}</th>
                  </tr>
                </thead>
                <tbody>
                  {shopOrders.map(o => (
                    <tr key={o.id}>
                      <td>{o.gene_trait
                        ? `${o.gene_trait} T${o.gene_tier}`
                        : `${o.item_key}${o.quantity > 1 ? ` x${o.quantity}` : ""}`}</td>
                      <td>{o.kind}</td>
                      <td style={{ fontFamily: "var(--font-mono)" }}>{o.price}</td>
                      <td>
                        <span style={{ color: o.status === "pending" ? "var(--warning)" : "var(--success)" }}>
                          {t(`market.shop.status.${o.status}`)}
                        </span>
                        {o.last_error && (
                          <span style={{ marginLeft: 6, fontSize: "0.7rem", color: "var(--danger)" }}>
                            {o.last_error}
                          </span>
                        )}
                      </td>
                      <td style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                        {fmtRelative(o.claimed_at || o.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {/* TAB: Browse */}
        {tab === "browse" && (
          <>
            <div style={{
              display: "flex", gap: "0.5rem", marginBottom: "0.7rem",
              flexWrap: "wrap", alignItems: "center",
            }}>
              <input
                className="form-input"
                placeholder={t("market.searchPh")}
                value={searchBp}
                onChange={e => setSearchBp(e.target.value)}
                onKeyDown={e => e.key === "Enter" && loadListed()}
                style={{ flex: "1 1 200px", minWidth: 0 }}
              />
              <select
                className="form-input"
                value={sort}
                onChange={e => { setSort(e.target.value as "newest" | "price_asc" | "price_desc"); }}
                style={{ flex: "0 0 auto" }}
              >
                <option value="newest">{t("market.sort.newest")}</option>
                <option value="price_asc">{t("market.sort.priceAsc")}</option>
                <option value="price_desc">{t("market.sort.priceDesc")}</option>
              </select>
              <button onClick={loadListed} className="btn btn-secondary btn-sm">
                <RefreshCw size={12} /> {t("common.refresh")}
              </button>
            </div>

            {listedLoading ? (
              <div className="pl-loading"><Loader2 size={16} className="pl-spin" /> {t("market.loading")}</div>
            ) : listed.length === 0 ? (
              <div className="pl-loading" style={{ textAlign: "left" }}>
                {t("market.empty")}
              </div>
            ) : (
              <>
                <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)", marginBottom: "0.4rem" }}>
                  {t("market.totalCount", { n: listedTotal })}
                </div>
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
                  gap: "0.7rem",
                }}>
                  {listed.map(it => (
                    <ItemCard
                      key={it.id}
                      it={it}
                      walletBal={wallet?.balance ?? 0}
                      walletLoaded={wallet !== null}
                      onBuy={() => handleBuy(it)}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {/* TAB: My items */}
        {tab === "mine" && (
          <>
            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.7rem", flexWrap: "wrap" }}>
              <Stat label="Draft" value={myStats.draft} color="#8b9a7e" />
              <Stat label="In vendita" value={myStats.listed} color="#8fce5a" />
              <Stat label="Venduti (in claim)" value={myStats.sold} color="#d9a061" />
              <Stat label="Conclusi" value={myStats.claimed} color="#5cb89a" />
            </div>
            {myLoading ? (
              <div className="pl-loading"><Loader2 size={16} className="pl-spin" /></div>
            ) : myItems.length === 0 ? (
              <div className="pl-loading" style={{ textAlign: "left" }}>
                {t("market.noMine")}
              </div>
            ) : (
              <table className="pl-table">
                <thead>
                  <tr>
                    <th>{t("market.col.item")}</th>
                    <th>{t("market.col.role")}</th>
                    <th>{t("market.col.status")}</th>
                    <th style={{ textAlign: "right" }}>{t("market.col.price")}</th>
                    <th style={{ width: 280 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {myItems.map(it => (
                    <tr key={it.id}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.55rem" }}>
                          <div style={{
                            width: 38, height: 38,
                            background: "linear-gradient(135deg, #131a13 0%, #1c261a 100%)",
                            borderRadius: 6, padding: 3, flexShrink: 0,
                            display: "flex", alignItems: "center", justifyContent: "center",
                          }}>
                            <ItemImage blueprint={it.blueprint} size={32} />
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 500 }}>{arkItemDisplayName(it.blueprint)}</div>
                            <div style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>
                              Qta: {it.quantity}
                              {it.quality > 0 ? ` · Q${it.quality}` : ""}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="pl-chip">{it.role}</span>
                      </td>
                      <td>
                        <StatusChip status={it.status} />
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 600 }}>
                        {it.price > 0 ? `${it.price.toLocaleString()} 🪙` : "—"}
                      </td>
                      <td>
                        {/* Actions per status */}
                        {it.role === "owner" && it.status === "draft" && (
                          <div style={{ display: "flex", gap: "0.3rem", justifyContent: "flex-end" }}>
                            <input
                              className="form-input"
                              placeholder="Prezzo"
                              type="number"
                              value={priceInput[it.id] ?? ""}
                              onChange={e => setPriceInput(p => ({ ...p, [it.id]: e.target.value }))}
                              style={{ width: 100, padding: "0.2rem 0.4rem", fontSize: "0.85rem" }}
                            />
                            <button onClick={() => handleList(it.id)} className="btn btn-primary btn-sm">
                              <Tag size={11} /> {t("market.publish")}
                            </button>
                          </div>
                        )}
                        {it.role === "owner" && it.status === "listed" && (
                          <div style={{ display: "flex", gap: "0.3rem", justifyContent: "flex-end" }}>
                            <button onClick={() => handleCancel(it.id)} className="btn btn-secondary btn-sm" style={{ color: "#d1614a" }}>
                              <Ban size={11} /> {t("market.cancel")}
                            </button>
                          </div>
                        )}
                        {it.status === "sold" && it.role === "buyer" && (
                          <span style={{ fontSize: "0.78rem", color: "#d9a061" }}>
                            {t("market.useClaim")}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {/* TAB: History */}
        {tab === "history" && (
          <>
            {histLoading ? (
              <div className="pl-loading"><Loader2 size={16} className="pl-spin" /></div>
            ) : history.length === 0 ? (
              <div className="pl-loading" style={{ textAlign: "left" }}>
                {t("market.noHistory")}
              </div>
            ) : (
              <table className="pl-table">
                <thead>
                  <tr>
                    <th>{t("market.col.when")}</th>
                    <th>{t("market.col.role")}</th>
                    <th>{t("market.col.item")}</th>
                    <th>{t("market.col.counter")}</th>
                    <th style={{ textAlign: "right" }}>{t("market.col.price")}</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(tx => (
                    <tr key={tx.id}>
                      <td style={{ fontSize: "0.78rem" }}>{fmtRelative(tx.created_at)}</td>
                      <td>
                        <span className="pl-chip" style={{
                          background: tx.role === "buyer" ? "#d1614a15" : "#8fce5a15",
                          color:      tx.role === "buyer" ? "#d1614a"   : "#8fce5a",
                          borderColor:tx.role === "buyer" ? "#d1614a40" : "#8fce5a40",
                        }}>
                          {tx.role === "buyer" ? t("market.bought2") : t("market.sold")}
                        </span>
                      </td>
                      <td>{tx.blueprint ? arkItemDisplayName(tx.blueprint) : "?"}</td>
                      <td style={{ fontSize: "0.78rem" }}>
                        {tx.counterpart_name || tx.counterpart_eos.slice(0, 8) + "…"}
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 600,
                        color: tx.role === "buyer" ? "#d1614a" : "#8fce5a" }}>
                        {tx.role === "buyer" ? "−" : "+"}{tx.price.toLocaleString()} 🪙
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </>
    </Wrapper>
  );
}

// ── Item card (Browse tab) ────────────────────────────────────────────────

function ItemCard({
  it, walletBal, walletLoaded, onBuy,
}: {
  it: MarketListedItem;
  walletBal: number;
  walletLoaded: boolean;
  onBuy: () => void;
}) {
  const { t } = useTranslation();
  const baseName   = arkItemDisplayName(it.blueprint);
  const isCryo     = !!it.dino;
  // For cryopods we override the headline with the species + level
  const display    = isCryo && it.dino?.species
    ? `${it.dino.species}${it.dino.level ? ` · Lvl ${it.dino.level}` : ""}`
    : baseName;
  const canAfford  = walletLoaded && walletBal >= it.price;
  const hasEnough  = !walletLoaded ? false : canAfford;
  const stats      = it.dino?.stats?.split(",").map(s => parseInt(s, 10)).filter(n => !isNaN(n)) ?? [];
  // ARK stat order on the level-up screen: HP / Stamina / Oxygen / Food /
  // Weight / MeleeDamage / MovementSpeed.  Cryopods sometimes record
  // 6 (no movement-speed) or 7 values; we render whatever we have.
  const STAT_LABELS = ["HP", "St", "Ox", "Fd", "Wt", "Dm", "Sp"];

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      background: "var(--bg-card, #fff)",
      border: "1px solid var(--border)",
      borderRadius: 10,
      overflow: "hidden",
      transition: "transform 0.15s, box-shadow 0.15s",
      cursor: "default",
    }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = "0 6px 18px rgba(0,0,0,0.12)";
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = "";
        e.currentTarget.style.boxShadow = "";
      }}
    >
      {/* Image header -- square aspect, dark backdrop so the wiki PNG
          (transparent background) reads against any theme.  For
          cryopods we paint a purple-ish gradient so they stand out
          from regular resources. */}
      <div style={{
        width: "100%", aspectRatio: "1 / 1",
        background: isCryo
          ? "linear-gradient(135deg, #4c1d95 0%, #1e1b4b 100%)"
          : "linear-gradient(135deg, #131a13 0%, #1c261a 100%)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "0.5rem", position: "relative",
      }}>
        {/* When this is a cryopod with a parsed species, fetch the
            DINO's image (e.g. 'Moschops.png') instead of the empty
            cryopod's icon.  The thumb proxy caches both kinds the
            same way. */}
        <ItemImage
          blueprint={it.blueprint}
          size={140}
          nameOverride={isCryo && it.dino?.species ? it.dino.species : undefined}
        />

        {/* Quantity badge overlay (top-right).  Cryopods are always
            quantity=1 so the badge is suppressed for them. */}
        {it.quantity > 1 && !isCryo && (
          <span style={{
            position: "absolute", top: 6, right: 6,
            background: "#000000aa", color: "#fff",
            fontSize: "0.78rem", fontWeight: 700,
            padding: "0.1rem 0.5rem", borderRadius: 99,
            pointerEvents: "none",
          }}>
            ×{it.quantity}
          </span>
        )}

        {/* Cryopod top-right: Lvl badge */}
        {isCryo && it.dino?.level && (
          <span style={{
            position: "absolute", top: 6, right: 6,
            background: "linear-gradient(135deg, #d9a061, #d9a061)",
            color: "#fff",
            fontSize: "0.78rem", fontWeight: 700,
            padding: "0.15rem 0.55rem", borderRadius: 99,
            pointerEvents: "none",
          }}>
            Lvl {it.dino.level}
          </span>
        )}

        {/* Blueprint badge overlay (top-left) when applicable */}
        {it.is_blueprint && (
          <span style={{
            position: "absolute", top: 6, left: 6,
            background: "#5cb89a", color: "#fff",
            fontSize: "0.65rem", fontWeight: 700,
            padding: "0.1rem 0.4rem", borderRadius: 4,
            letterSpacing: 0.5, textTransform: "uppercase",
            pointerEvents: "none",
          }}>
            BP
          </span>
        )}

        {/* Cryopod top-left: gender icon -- bigger than a regular
            badge so it reads at a glance from across the listings
            grid (operator request). */}
        {isCryo && it.dino?.gender && (
          <span style={{
            position: "absolute", top: 6, left: 6,
            background: it.dino.gender === "FEMALE" ? "#c2739e" : "#5cb89a",
            color: "#fff",
            // Bigger circular chip with the gender glyph centred.
            width: 36, height: 36, borderRadius: "50%",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "1.6rem", fontWeight: 700, lineHeight: 1,
            boxShadow: "0 2px 6px rgba(0,0,0,0.45)",
            border: "2px solid #ffffff66",
            pointerEvents: "none",
          }}
          title={it.dino.gender}
          >
            {it.dino.gender === "FEMALE" ? "♀" : "♂"}
          </span>
        )}
      </div>

      {/* Body -- name + meta */}
      <div style={{ padding: "0.6rem 0.7rem", flex: 1, display: "flex", flexDirection: "column" }}>
        <div style={{
          fontWeight: 600, fontSize: "0.95rem",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}
          title={display}
        >
          {display}
        </div>

        {/* Stat chips row.  For cryopods we replace the generic
            Q/durability/rating triplet with the dino's stat
            distribution (HP/St/Ox/Fd/Wt/Dm/Sp -- whatever the blob
            gave us). */}
        {isCryo && stats.length > 0 ? (
          <div style={{
            display: "grid",
            gridTemplateColumns: `repeat(${Math.min(stats.length, 7)}, 1fr)`,
            gap: "0.2rem", marginTop: "0.4rem",
          }}>
            {stats.map((v, i) => (
              <div key={i} style={{
                background: "var(--bg-card-muted, #f5f5f7)",
                borderRadius: 4, padding: "0.2rem 0.1rem",
                textAlign: "center", fontSize: "0.7rem",
              }}>
                <div style={{ color: "var(--text-secondary)", fontSize: "0.6rem", lineHeight: 1 }}>
                  {STAT_LABELS[i] ?? `S${i+1}`}
                </div>
                <div style={{ fontWeight: 700, lineHeight: 1.1 }}>{v}</div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{
            display: "flex", flexWrap: "wrap", gap: "0.25rem",
            marginTop: "0.3rem",
            fontSize: "0.68rem", color: "var(--text-secondary)",
          }}>
            {it.quality > 0 && (
              <span className="pl-chip" style={{ padding: "0.1rem 0.35rem" }}>
                Q{it.quality}
              </span>
            )}
            {/* Durability rendered as % ONLY when in canonical 0-100
                range; cryopods (and some plugin-managed items) stuff
                non-percentage data here. */}
            {it.durability > 0 && it.durability <= 100 && (
              <span className="pl-chip" style={{ padding: "0.1rem 0.35rem" }}>
                {Math.round(it.durability)}%
              </span>
            )}
            {it.rating > 0 && (
              <span className="pl-chip" style={{ padding: "0.1rem 0.35rem" }}>
                ★ {it.rating.toFixed(1)}
              </span>
            )}
          </div>
        )}

        {/* Seller line */}
        <div style={{
          fontSize: "0.7rem", color: "var(--text-secondary)",
          marginTop: "0.4rem",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {t("market.byShort")}{" "}
          <strong style={{ color: "var(--text)" }}>
            {it.owner_name || it.owner_eos_id.slice(0, 8) + "…"}
          </strong>
          {it.listed_at && (
            <span style={{ marginLeft: 6, opacity: 0.85 }}>
              · {fmtRelative(it.listed_at)}
            </span>
          )}
        </div>

        {/* Price + buy footer */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginTop: "0.65rem", paddingTop: "0.55rem",
          borderTop: "1px solid var(--border)",
          gap: "0.4rem",
        }}>
          <div style={{
            display: "flex", alignItems: "center", gap: "0.25rem",
            fontSize: "1.15rem", fontWeight: 700,
            color: hasEnough ? "#8fce5a" : "#d1614a",
          }}>
            <Coins size={14} /> {it.price.toLocaleString()}
          </div>
          <button
            onClick={onBuy}
            className="btn btn-primary btn-sm"
            disabled={!walletLoaded || !canAfford}
            title={
              !walletLoaded ? "Wallet non disponibile"
              : !canAfford  ? "Saldo insufficiente" : ""
            }
            style={{ padding: "0.35rem 0.65rem" }}
          >
            <ShoppingBag size={12} /> {t("market.buy")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Item image with graceful fallback.  Triggers an onError swap to a
 * generic ARK-style placeholder when the wiki has no image (mod
 * items, typos in the blueprint name).
 *
 * Optional `nameOverride` lets a caller request a different wiki page
 * than the one derived from the blueprint -- used by cryopod cards
 * to fetch the dino's species image (e.g. 'Moschops') instead of
 * the cryopod item's own icon.
 */
function ItemImage({
  blueprint, size, nameOverride,
}: {
  blueprint: string;
  size: number;
  nameOverride?: string;
}) {
  const [errored, setErrored] = useState(false);

  // Build the URL: when nameOverride is supplied, hit the thumb proxy
  // with that name directly; otherwise derive from the blueprint as
  // before.  Both go through /api/v1/market/thumb/<name> which caches
  // the wiki response on first hit.
  const url = nameOverride
    ? `/api/v1/market/thumb/${encodeURIComponent(nameOverride)}`
    : arkItemThumbUrl(blueprint);

  // Reset the error flag when the image source changes (e.g. a sync
  // re-fetch hands us a different blueprint mid-render).
  useEffect(() => { setErrored(false); }, [url]);

  if (!url || errored) {
    return (
      <div style={{
        width: size, height: size,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "#ffffff10", color: "#8b9a7e", borderRadius: 8,
      }}>
        <Package size={Math.round(size * 0.45)} />
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={nameOverride ?? arkItemDisplayName(blueprint)}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setErrored(true)}
      style={{
        width: size, height: size, objectFit: "contain",
        // Subtle drop-shadow so light icons read against the gradient.
        filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))",
      }}
    />
  );
}


// ── Helpers ────────────────────────────────────────────────────────────────

function TabBtn({ active, onClick, icon, label }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={active ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"}
      style={{ display: "flex", alignItems: "center", gap: "0.35rem", opacity: active ? 1 : 0.85 }}
    >
      {icon} {label}
    </button>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="pl-sync-panel" style={{ padding: "0.5rem 0.7rem", display: "flex", flexDirection: "column", alignItems: "center", minWidth: 100 }}>
      <div style={{ fontSize: "1.4rem", fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: "0.7rem", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.4 }}>
        {label}
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const colors: Record<string, [string, string]> = {
    draft:   ["#8b9a7e", "Bozza"],
    listed:  ["#8fce5a", "In vendita"],
    sold:    ["#d9a061", "Venduto"],
    claimed: ["#5cb89a", "Concluso"],
  };
  const [c, lbl] = colors[status] ?? ["#8b9a7e", status];
  return (
    <span className="pl-chip" style={{
      background: `${c}15`, color: c, borderColor: `${c}40`,
    }}>
      {lbl}
    </span>
  );
}

/**
 * Immagine di una voce di catalogo, con ripiego a icona.
 *
 * La wiki non ha una pagina per tutto (oggetti mod, nomi non standard):
 * si prova ogni candidato in ordine (boss, primo pezzo del pacchetto,
 * blueprint, etichetta) e solo quando falliscono tutti si mostra l'icona
 * del tipo — mai un riquadro rotto, la griglia resta allineata.
 */
function ShopThumb({ entry, size }: { entry: WebShopItem; size: number }) {
  const [idx, setIdx] = useState(0);
  const candidates = shopEntryThumbCandidates(entry);
  const box: React.CSSProperties = {
    width: size, height: size, flexShrink: 0, borderRadius: 6,
    background: "var(--bg-card-muted)", display: "flex",
    alignItems: "center", justifyContent: "center",
  };
  if (idx >= candidates.length)
    return (
      <div style={box}>
        <ShopFallbackIcon kind={entry.kind} size={Math.round(size * 0.5)} />
      </div>
    );
  return (
    <img src={candidates[idx]} alt="" loading="lazy"
      style={{ ...box, objectFit: "contain" }}
      onError={() => setIdx(i => i + 1)} />
  );
}

/** Chip di filtro categoria sopra la vetrina dello shop. */
function CategoryChip({ label, count, active, onClick }: {
  label: string; count: number; active: boolean; onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="btn btn-sm"
      style={{
        border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
        background: active ? "var(--accent)" : "transparent",
        color: active ? "#fff" : "var(--text)",
        borderRadius: 99, padding: "0.15rem 0.6rem", fontSize: "0.75rem",
      }}>
      {label}
      <span style={{ marginLeft: 5, opacity: 0.7 }}>{count}</span>
    </button>
  );
}

/** Icona di una riga dentro il dettaglio del pacchetto. */
function LineThumb({ blueprint }: { blueprint: string }) {
  const [failed, setFailed] = useState(false);
  const url = arkItemThumbUrl(blueprint);
  if (!url || failed)
    return <span style={{ width: 18, height: 18, flexShrink: 0 }} />;
  return (
    <img src={url} alt="" width={18} height={18}
      style={{ objectFit: "contain", flexShrink: 0 }}
      onError={() => setFailed(true)} />
  );
}
