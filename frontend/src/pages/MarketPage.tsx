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
      n: shortBp(item.blueprint), p: item.price,
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
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "0.6rem" }}>
                  {listed.map(it => (
                    <div key={it.id} className="pl-sync-panel" style={{ padding: "0.7rem 0.85rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontWeight: 600, fontSize: "0.95rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {shortBp(it.blueprint)}
                          </div>
                          <div style={{ fontSize: "0.72rem", color: "var(--text-secondary)", marginTop: 2 }}>
                            {t("market.qty", { defaultValue: "Qta:" })} {it.quantity}
                            {it.is_blueprint ? " · BP" : ""}
                            {it.quality > 0 ? ` · Q${it.quality}` : ""}
                            {it.durability > 0 ? ` · ${Math.round(it.durability)}%` : ""}
                          </div>
                          <div style={{ fontSize: "0.7rem", color: "var(--text-secondary)", marginTop: 2 }}>
                            {t("market.seller", { defaultValue: "Venditore:" })}{" "}
                            <strong style={{ color: "var(--text)" }}>{it.owner_name || it.owner_eos_id.slice(0, 8) + "…"}</strong>
                            {it.listed_at ? ` · ${fmtRelative(it.listed_at)}` : ""}
                          </div>
                        </div>
                      </div>
                      <div style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        marginTop: "0.7rem", gap: "0.5rem",
                      }}>
                        <span style={{ fontSize: "1.2rem", fontWeight: 700, color: "#16a34a" }}>
                          <Coins size={14} /> {it.price.toLocaleString()}
                        </span>
                        <button
                          onClick={() => handleBuy(it)}
                          className="btn btn-primary btn-sm"
                          disabled={!wallet || wallet.balance < it.price}
                          title={!wallet ? "Wallet non disponibile" : (wallet.balance < it.price ? "Saldo insufficiente" : "")}
                        >
                          <ShoppingBag size={12} /> {t("market.buy", { defaultValue: "Acquista" })}
                        </button>
                      </div>
                    </div>
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
                        <div style={{ fontWeight: 500 }}>{shortBp(it.blueprint)}</div>
                        <div style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>
                          Qta: {it.quantity} {it.quality > 0 ? `· Q${it.quality}` : ""}
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
                      <td>{shortBp(tx.blueprint || "?")}</td>
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
