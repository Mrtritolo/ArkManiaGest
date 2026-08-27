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
  Store, Dna, Inbox,
} from "lucide-react";
import {
  marketApi, webShopApi,
  type MarketListedItem, type MarketMyItem, type MarketWallet,
  type MarketTransaction,
  type WebShopItem, type WebShopGene, type WebShopOrder,
} from "../services/api";
import { arkItemDisplayName, arkItemThumbUrl } from "../utils/arkItem";
import type { AuthUser } from "../types";

type TabKey = "browse" | "mine" | "history" | "shop" | "genes" | "orders";

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
  const [geneTier, setGeneTier] = useState<Record<string, number>>({});

  const loadShop = useCallback(async () => {
    setShopLoading(true);
    try {
      const r = await webShopApi.catalog();
      setShopItems(r.data.items || []);
      setShopGenes(r.data.genes || []);
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

  /**
   * Compra e mette in coda. Ricarica il portafoglio subito dopo: i punti
   * sono la cosa che l'utente controlla per capire se e' andata a buon fine.
   */
  async function doBuy(kind: "item" | "dino" | "gene", key: string,
                       label: string, price: number, tier = 1) {
    if (!window.confirm(t("market.shop.confirmBuy", { what: label, price })))
      return;
    setShopBusy(key); setError(""); setSuccess("");
    try {
      const r = await webShopApi.buy(kind, key, 1, tier);
      setSuccess(t("market.shop.bought", { spent: r.data.spent }));
      await Promise.all([loadWallet(), loadShopOrders()]);
    } catch (e: any) {
      setError(e.response?.data?.detail || String(e));
    } finally {
      setShopBusy(null);
    }
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
    if (tab === "shop" || tab === "genes") loadShop();
    if (tab === "orders") loadShopOrders();
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

  async function handleBuy(item: MarketListedItem) {
    if (!confirm(t("market.confirmBuy", {
      n: arkItemDisplayName(item.blueprint), p: item.price,
    }))) return;
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
              <div className="pl-chip" style={{ background: "#16a34a15", color: "#16a34a", borderColor: "#16a34a40", fontSize: "0.85rem" }}>
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
              background: "linear-gradient(135deg, #16a34a 0%, #047857 100%)",
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
                <div style={{
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
            {shopLoading ? (
              <div style={{ padding: "1rem", color: "var(--text-muted)" }}>
                <Loader2 size={14} className="pl-spin" /> {t("common.loading")}
              </div>
            ) : shopItems.length === 0 ? (
              <div className="alert alert-info">{t("market.shop.emptyItems")}</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: "0.6rem" }}>
                {shopItems
                  .filter(i => !shopSearch ||
                    i.label.toLowerCase().includes(shopSearch.toLowerCase()) ||
                    i.category.toLowerCase().includes(shopSearch.toLowerCase()))
                  .map(i => (
                  <div key={i.key} className="card" style={{ padding: "0.7rem" }}>
                    <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>{i.label}</div>
                    <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginBottom: 6 }}>
                      {i.category || "—"}
                      {i.kind === "dino"
                        ? ` · ${t("market.shop.dinoLevel", { lvl: i.dino_level })}`
                        : ` · x${i.quantity}`}
                      {i.is_blueprint ? " · BP" : ""}
                    </div>
                    {i.kind === "dino" && (
                      <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginBottom: 6 }}>
                        {t("market.shop.dinoInPod")}
                      </div>
                    )}
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
                ))}
              </div>
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
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "0.6rem" }}>
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
                          onClick={() => doBuy("gene", g.key, `${g.label} T${tier}`, price, tier)}>
                          {shopBusy === g.key
                            ? <Loader2 size={12} className="pl-spin" />
                            : <ShoppingBag size={12} />} {t("market.shop.buy")}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: 8 }}>
              {t("market.shop.geneHint")}
            </div>
          </>
        )}

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
              <Stat label="Draft" value={myStats.draft} color="#6b7280" />
              <Stat label="In vendita" value={myStats.listed} color="#16a34a" />
              <Stat label="Venduti (in claim)" value={myStats.sold} color="#d97706" />
              <Stat label="Conclusi" value={myStats.claimed} color="#2563eb" />
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
                            background: "linear-gradient(135deg, #1f2937 0%, #374151 100%)",
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
                            <button onClick={() => handleCancel(it.id)} className="btn btn-secondary btn-sm" style={{ color: "#dc2626" }}>
                              <Ban size={11} /> {t("market.cancel")}
                            </button>
                          </div>
                        )}
                        {it.status === "sold" && it.role === "buyer" && (
                          <span style={{ fontSize: "0.78rem", color: "#d97706" }}>
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
                          background: tx.role === "buyer" ? "#dc262615" : "#16a34a15",
                          color:      tx.role === "buyer" ? "#dc2626"   : "#16a34a",
                          borderColor:tx.role === "buyer" ? "#dc262640" : "#16a34a40",
                        }}>
                          {tx.role === "buyer" ? t("market.bought2") : t("market.sold")}
                        </span>
                      </td>
                      <td>{tx.blueprint ? arkItemDisplayName(tx.blueprint) : "?"}</td>
                      <td style={{ fontSize: "0.78rem" }}>
                        {tx.counterpart_name || tx.counterpart_eos.slice(0, 8) + "…"}
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 600,
                        color: tx.role === "buyer" ? "#dc2626" : "#16a34a" }}>
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
          : "linear-gradient(135deg, #1f2937 0%, #374151 100%)",
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
            background: "linear-gradient(135deg, #f59e0b, #d97706)",
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
            background: "#2563eb", color: "#fff",
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
            background: it.dino.gender === "FEMALE" ? "#ec4899" : "#3b82f6",
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
            color: hasEnough ? "#16a34a" : "#dc2626",
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
        background: "#ffffff10", color: "#9ca3af", borderRadius: 8,
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
    draft:   ["#6b7280", "Bozza"],
    listed:  ["#16a34a", "In vendita"],
    sold:    ["#d97706", "Venduto"],
    claimed: ["#2563eb", "Concluso"],
  };
  const [c, lbl] = colors[status] ?? ["#6b7280", status];
  return (
    <span className="pl-chip" style={{
      background: `${c}15`, color: c, borderColor: `${c}40`,
    }}>
      {lbl}
    </span>
  );
}
