/**
 * BrowseTab -- every item other players have listed.
 *
 * The search is debounced (Enter applies it at once) and the grid stays on
 * screen while the new page is fetched: the list used to be replaced by a
 * spinner on every keystroke pause.
 */
import { useTranslation } from "react-i18next";
import { Package, RefreshCw } from "lucide-react";
import { Button, EmptyState, Input, Select, Spinner } from "../../../components/ui";
import type { MarketListedItem, MarketWallet } from "../../../services/api";
import type { MarketSort } from "../hooks/useMarketplace";
import { ItemCard } from "../components/ItemCard";
import styles from "../MarketPage.module.css";

export interface BrowseTabProps {
  searchBp: string;
  setSearchBp: (value: string) => void;
  applySearchNow: () => void;
  sort: MarketSort;
  setSort: (value: MarketSort) => void;
  onRefresh: () => void;
  loading: boolean;
  moreLoading: boolean;
  listed: MarketListedItem[];
  listedTotal: number;
  wallet: MarketWallet | null;
  onBuy: (item: MarketListedItem) => void;
  onLoadMore: () => void;
}

export function BrowseTab({
  searchBp, setSearchBp, applySearchNow, sort, setSort, onRefresh,
  loading, moreLoading, listed, listedTotal, wallet, onBuy, onLoadMore,
}: BrowseTabProps) {
  const { t } = useTranslation();
  const firstLoad = loading && listed.length === 0;

  return (
    <div className="l-stack">
      <div className="l-cluster">
        <Input
          type="search"
          aria-label={t("market.searchPh")}
          placeholder={t("market.searchPh")}
          value={searchBp}
          onChange={e => setSearchBp(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") applySearchNow(); }}
        />
        <Select
          aria-label={t("market.sortLabel")}
          value={sort}
          onChange={e => setSort(e.target.value as MarketSort)}
        >
          <option value="newest">{t("market.sort.newest")}</option>
          <option value="price_asc">{t("market.sort.priceAsc")}</option>
          <option value="price_desc">{t("market.sort.priceDesc")}</option>
        </Select>
        <Button icon={RefreshCw} onClick={onRefresh}>{t("common.refresh")}</Button>
        {/* Refetch: the grid below stays visible, this says it is working. */}
        {loading && !firstLoad && <Spinner label={t("market.loading")} />}
      </div>

      {firstLoad ? (
        <Spinner block label={t("market.loading")} />
      ) : listed.length === 0 ? (
        <EmptyState icon={Package} title={t("market.empty")} />
      ) : (
        <>
          <p className={styles.sellerLine} role="status">
            {t("market.totalCount", { n: listedTotal })}
          </p>
          <div className="l-grid--cards">
            {listed.map(it => (
              <ItemCard
                key={it.id}
                it={it}
                walletBal={wallet?.balance ?? 0}
                walletLoaded={wallet !== null}
                onBuy={() => onBuy(it)}
              />
            ))}
          </div>
          {listed.length < listedTotal && (
            <div className="l-cluster l-cluster--end">
              <Button
                loading={moreLoading}
                loadingLabel={t("common.loading")}
                disabled={moreLoading}
                onClick={onLoadMore}
              >
                {t("market.loadMore", { n: listed.length, total: listedTotal })}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
