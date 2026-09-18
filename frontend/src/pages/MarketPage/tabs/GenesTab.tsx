/**
 * GenesTab -- the GeneShop: one trait per card, tier picked per card, species
 * picked once for the whole tab.
 *
 * Species first, trait second: that is the order you think in while scanning
 * in game, and a purchase is always "this trait, taken from this species".
 */
import { useTranslation } from "react-i18next";
import { Dna, ShoppingBag } from "lucide-react";
import { Button, EmptyState, Field, Input, Select, Spinner } from "../../../components/ui";
import type { WebShopGene, WebShopGeneDino } from "../../../services/api";
import { Points } from "../components/Points";
import styles from "../MarketPage.module.css";

export interface GenesTabProps {
  shopSearch: string;
  setShopSearch: (value: string) => void;
  shopLoading: boolean;
  shopGenes: WebShopGene[];
  shopGeneDinos: WebShopGeneDino[];
  geneSpecies: string;
  setGeneSpecies: (value: string) => void;
  geneTier: Record<string, number>;
  setGeneTier: (update: (prev: Record<string, number>) => Record<string, number>) => void;
  shopBusy: string | null;
  onBuy: (kind: "gene", key: string, label: string, price: number, tier: number, species: string) => void;
}

export function GenesTab({
  shopSearch, setShopSearch, shopLoading, shopGenes, shopGeneDinos,
  geneSpecies, setGeneSpecies, geneTier, setGeneTier, shopBusy, onBuy,
}: GenesTabProps) {
  const { t } = useTranslation();
  const q = shopSearch.toLowerCase();
  const visible = shopGenes.filter(g => !shopSearch
    || g.label.toLowerCase().includes(q)
    || g.category.toLowerCase().includes(q));

  return (
    <div className="l-stack">
      <div className="l-cluster">
        <Input
          type="search"
          aria-label={t("market.shop.searchPh")}
          placeholder={t("market.shop.searchPh")}
          value={shopSearch}
          onChange={e => setShopSearch(e.target.value)}
        />
        {/* Refetch: the grid below stays visible, this says it is working. */}
        {shopLoading && shopGenes.length > 0 && <Spinner label={t("common.loading")} />}
      </div>

      {shopLoading && shopGenes.length === 0 ? (
        <Spinner block label={t("common.loading")} />
      ) : shopGenes.length === 0 ? (
        <EmptyState icon={Dna} title={t("market.shop.emptyGenes")} />
      ) : (
        <>
          {shopGeneDinos.length > 0 && (
            <Field label={t("market.shop.geneSpecies")}>
              <Select value={geneSpecies} onChange={e => setGeneSpecies(e.target.value)}>
                <option value="">{t("market.shop.geneSpeciesNone")}</option>
                {shopGeneDinos.map(d => (
                  <option key={d.blueprint} value={d.blueprint}>{d.label}</option>
                ))}
              </Select>
            </Field>
          )}

          {visible.length === 0 ? (
            <EmptyState icon={Dna} title={t("market.shop.noMatch")} />
          ) : (
            <div className="l-grid--cards">
              {visible.map(g => {
                const tier = geneTier[g.key] || 1;
                const price = g.prices[String(tier)] ?? 0;
                const label = t("market.shop.geneTierLabel", { name: g.label, tier });
                return (
                  <div key={g.key} className={styles.shopCard}>
                    <div>
                      <div className={styles.shopCardName}>{g.label}</div>
                      <div className="u-muted u-text-sm">{g.category}</div>
                    </div>
                    <p className={styles.sellerLine}>{g.description}</p>
                    <div className={styles.cardFooter}>
                      <div className="l-cluster">
                        <Select
                          size="sm"
                          aria-label={t("market.shop.tierFor", { name: g.label })}
                          value={tier}
                          onChange={e => setGeneTier(s => ({ ...s, [g.key]: Number(e.target.value) }))}
                        >
                          <option value={1}>{t("market.shop.tier", { n: 1 })}</option>
                          <option value={2}>{t("market.shop.tier", { n: 2 })}</option>
                          <option value={3}>{t("market.shop.tier", { n: 3 })}</option>
                        </Select>
                        <Points value={price} />
                      </div>
                      <Button
                        variant="primary"
                        size="sm"
                        icon={ShoppingBag}
                        loading={shopBusy === g.key}
                        loadingLabel={t("market.buyModal.buying")}
                        disabled={shopBusy !== null || price <= 0}
                        aria-label={t("market.buyAria", { item: label, price: price.toLocaleString() })}
                        onClick={() => onBuy("gene", g.key, label, price, tier, geneSpecies)}
                      >
                        {t("market.shop.buy")}
                      </Button>
                      {price <= 0 && (
                        <span className={styles.buyNote}>{t("market.shop.noPriceSet")}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <p className="u-muted u-text-sm">{t("market.shop.geneHint")}</p>
    </div>
  );
}
