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
} from "lucide-react";
import {
  marketApi,
  type MarketListedItem, type MarketMyItem, type MarketWallet,
  type MarketTransaction,
} from "../services/api";
import { arkItemDisplayName, arkItemThumbUrl } from "../utils/arkItem";

type TabKey = "browse" | "mine" | "history";

interface MarketPageProps {
  embedded?: boolean;
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

export default function MarketPage({ embedded = false }: MarketPageProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabKey>("browse");

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
      setError(extractError(err, t("market.errors.loadListed", { defaultValue: "Caricamento mercato fallito." })));
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
      setError(extractError(err, t("market.errors.loadMine", { defaultValue: "Caricamento miei item fallito." })));
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
      setError(extractError(err, t("market.errors.loadHistory", { defaultValue: "Caricamento storico fallito." })));
    } finally {
      setHistLoading(false);
    }
  }, [t]);

  useEffect(() => { loadListed(); loadWallet(); }, [loadListed, loadWallet]);
  useEffect(() => {
    if (tab === "mine") loadMyItems();
    if (tab === "history") loadHistory();
  }, [tab, loadMyItems, loadHistory]);

  // Auto-clear toasts.
  useEffect(() => {
    if (!success) return;
    const x = setTimeout(() => setSuccess(""), 3000);
    return () => clearTimeout(x);
  }, [success]);

  async function handleBuy(item: MarketListedItem) {
    if (!confirm(t("market.confirmBuy", {
      defaultValue: "Acquisti '{{n}}' per {{p}} coins?",
      n: arkItemDisplayName(item.blueprint), p: item.price,
    }))) return;
    try {
      const res = await marketApi.buy(item.id);
      setSuccess(t("market.bought", {
        defaultValue: "Acquistato! Nuovo saldo: {{b}}. Usa /market claim in-game per ritirarlo.",
        b: res.data.new_balance,
      }));
      setListed(prev => prev.filter(i => i.id !== item.id));
      setListedTotal(t => t - 1);
      loadWallet();
    } catch (err) {
      setError(extractError(err, t("market.errors.buy", { defaultValue: "Acquisto fallito." })));
    }
  }

  async function handleList(itemId: number) {
    const raw = priceInput[itemId];
    const price = parseInt(raw || "", 10);
    if (!price || price <= 0) {
      setError(t("market.errors.priceRequired", { defaultValue: "Inserisci un prezzo valido." }));
      return;
    }
    try {
      await marketApi.listForSale(itemId, price);
      setSuccess(t("market.listed", { defaultValue: "Item pubblicato sul mercato." }));
      setPriceInput(p => ({ ...p, [itemId]: "" }));
      loadMyItems();
      loadListed();
    } catch (err) {
      setError(extractError(err, t("market.errors.list", { defaultValue: "Pubblicazione fallita." })));
    }
  }

  async function handleCancel(itemId: number) {
    if (!confirm(t("market.confirmCancel", {
      defaultValue: "Annullare il listing?  L'item tornerà a te via /market claim in-game.",
    }))) return;
    try {
      await marketApi.cancel(itemId);
      setSuccess(t("market.cancelled", {
        defaultValue: "Annullato. Usa /market claim in-game per recuperarlo.",
      }));
      loadMyItems();
      loadListed();
    } catch (err) {
      setError(extractError(err, t("market.errors.cancel", { defaultValue: "Cancellazione fallita." })));
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
                {t("market.title", { defaultValue: "Mercato giocatori" })}
              </h1>
              <p className="pl-subtitle">
                {t("market.subtitle", { defaultValue: "Compra, vendi e gestisci i tuoi item ARK." })}
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
                    {t("market.title", { defaultValue: "Mercato giocatori" })}
                  </div>
                  <div style={{ fontSize: "0.78rem", opacity: 0.9 }}>
                    {t("market.subtitle", { defaultValue: "Compra, vendi e gestisci i tuoi item ARK." })}
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
                  label={t("market.tab.browse", { defaultValue: "Sfoglia" })} />
          <TabBtn active={tab === "mine"}    onClick={() => setTab("mine")}
                  icon={<Package size={14} />}
                  label={t("market.tab.mine", { defaultValue: "I miei item" })} />
          <TabBtn active={tab === "history"} onClick={() => setTab("history")}
                  icon={<History size={14} />}
                  label={t("market.tab.history", { defaultValue: "Storico" })} />
        </div>

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

        {/* TAB: Browse */}
        {tab === "browse" && (
          <>
            <div style={{
              display: "flex", gap: "0.5rem", marginBottom: "0.7rem",
              flexWrap: "wrap", alignItems: "center",
            }}>
              <input
                className="form-input"
                placeholder={t("market.searchPh", { defaultValue: "Cerca per blueprint…" })}
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
                <option value="newest">{t("market.sort.newest", { defaultValue: "Più recenti" })}</option>
                <option value="price_asc">{t("market.sort.priceAsc", { defaultValue: "Prezzo crescente" })}</option>
                <option value="price_desc">{t("market.sort.priceDesc", { defaultValue: "Prezzo decrescente" })}</option>
              </select>
              <button onClick={loadListed} className="btn btn-secondary btn-sm">
                <RefreshCw size={12} /> {t("common.refresh", { defaultValue: "Aggiorna" })}
              </button>
            </div>

            {listedLoading ? (
              <div className="pl-loading"><Loader2 size={16} className="pl-spin" /> {t("market.loading", { defaultValue: "Caricamento…" })}</div>
            ) : listed.length === 0 ? (
              <div className="pl-loading" style={{ textAlign: "left" }}>
                {t("market.empty", { defaultValue: "Nessun item in vendita." })}
              </div>
            ) : (
              <>
                <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)", marginBottom: "0.4rem" }}>
                  {t("market.totalCount", { defaultValue: "{{n}} item disponibili", n: listedTotal })}
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
                {t("market.noMine", { defaultValue: "Non hai item nel mercato.  Usa /market upload in-game per inserirne uno." })}
              </div>
            ) : (
              <table className="pl-table">
                <thead>
                  <tr>
                    <th>{t("market.col.item", { defaultValue: "Item" })}</th>
                    <th>{t("market.col.role", { defaultValue: "Ruolo" })}</th>
                    <th>{t("market.col.status", { defaultValue: "Stato" })}</th>
                    <th style={{ textAlign: "right" }}>{t("market.col.price", { defaultValue: "Prezzo" })}</th>
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
                              <Tag size={11} /> {t("market.publish", { defaultValue: "Pubblica" })}
                            </button>
                          </div>
                        )}
                        {it.role === "owner" && it.status === "listed" && (
                          <div style={{ display: "flex", gap: "0.3rem", justifyContent: "flex-end" }}>
                            <button onClick={() => handleCancel(it.id)} className="btn btn-secondary btn-sm" style={{ color: "#dc2626" }}>
                              <Ban size={11} /> {t("market.cancel", { defaultValue: "Annulla" })}
                            </button>
                          </div>
                        )}
                        {it.status === "sold" && it.role === "buyer" && (
                          <span style={{ fontSize: "0.78rem", color: "#d97706" }}>
                            {t("market.useClaim", { defaultValue: "Usa /market claim in-game" })}
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
                {t("market.noHistory", { defaultValue: "Nessuna transazione." })}
              </div>
            ) : (
              <table className="pl-table">
                <thead>
                  <tr>
                    <th>{t("market.col.when", { defaultValue: "Quando" })}</th>
                    <th>{t("market.col.role", { defaultValue: "Ruolo" })}</th>
                    <th>{t("market.col.item", { defaultValue: "Item" })}</th>
                    <th>{t("market.col.counter", { defaultValue: "Controparte" })}</th>
                    <th style={{ textAlign: "right" }}>{t("market.col.price", { defaultValue: "Prezzo" })}</th>
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
                          {tx.role === "buyer" ? t("market.bought2", { defaultValue: "comprato" }) : t("market.sold", { defaultValue: "venduto" })}
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
        <ItemImage blueprint={it.blueprint} size={140} />

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

        {/* Cryopod top-left: gender icon */}
        {isCryo && it.dino?.gender && (
          <span style={{
            position: "absolute", top: 6, left: 6,
            background: it.dino.gender === "FEMALE" ? "#ec4899" : "#3b82f6",
            color: "#fff",
            fontSize: "0.7rem", fontWeight: 700,
            padding: "0.15rem 0.4rem", borderRadius: 4,
            pointerEvents: "none",
          }}>
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
          {t("market.byShort", { defaultValue: "Da" })}{" "}
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
            <ShoppingBag size={12} /> {t("market.buy", { defaultValue: "Acquista" })}
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
 */
function ItemImage({ blueprint, size }: { blueprint: string; size: number }) {
  const [errored, setErrored] = useState(false);
  const url = arkItemThumbUrl(blueprint);

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
      alt={arkItemDisplayName(blueprint)}
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
