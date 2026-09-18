/**
 * MarketPage -- ArkMania marketplace + server shop.
 *
 * Two render modes:
 *   - standalone (a Discord-only player): own <main>, player density.
 *   - embedded (admin sidebar route): a block inside the admin shell.
 *
 * Eight sections, all Tabs: the player-to-player market (browse, my items,
 * history), the server shop (catalogue, GeneShop, egg/embryo forge, my
 * purchases) and the operator price desk. The two halves share the page and
 * the wallet and nothing else -- see useMarketplace / useWebShop.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Coins, Dna, Egg, History, Inbox, Package, RotateCw, Search, Store,
} from "lucide-react";
import {
  Alert, Button, Tabs, useConfirm, useToast, type TabItem,
} from "../../components/ui";
import type { AuthUser } from "../../types";
import type { TabKey } from "./marketUtils";
import { usePurchaseConfirm } from "./hooks/usePurchaseConfirm";
import { useMarketplace } from "./hooks/useMarketplace";
import { useWebShop } from "./hooks/useWebShop";
import { useForgeConfigurator } from "./hooks/useForgeConfigurator";
import { useAdminPrices } from "./hooks/useAdminPrices";
import { MarketLayout } from "./components/MarketLayout";
import { BuyConfirmModal } from "./components/BuyConfirmModal";
import { BrowseTab } from "./tabs/BrowseTab";
import { MyItemsTab } from "./tabs/MyItemsTab";
import { HistoryTab } from "./tabs/HistoryTab";
import { ShopTab } from "./tabs/ShopTab";
import { GenesTab } from "./tabs/GenesTab";
import { ForgeTab } from "./tabs/ForgeTab";
import { OrdersTab } from "./tabs/OrdersTab";
import { PricesTab } from "./tabs/PricesTab";

interface MarketPageProps {
  embedded?: boolean;
  /** Only in the admin variant: the panel role that gates the price desk. */
  currentUser?: AuthUser | null;
}

export default function MarketPage({ embedded = false, currentUser }: MarketPageProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const askConfirm = useConfirm();

  // Catalogue import and price edits are operator work on the backend; the
  // price READ is open to any panel role, so the tab is too.
  const canOperate = currentUser?.role === "admin" || currentUser?.role === "operator";
  const isPanelUser = Boolean(currentUser);

  const [tab, setTab] = useState<TabKey>("browse");
  /** Page-load failure (Alert). Action results are toasts, buy errors dialogs. */
  const [loadError, setLoadError] = useState("");

  // Must come first: the other three hooks queue their purchases through it.
  const purchase = usePurchaseConfirm();
  const market = useMarketplace({
    setLoadError, toast, requestBuy: purchase.requestBuy, askConfirm, t,
  });
  const shop = useWebShop({
    setLoadError, toast, loadWallet: market.loadWallet,
    requestBuy: purchase.requestBuy, t,
  });
  const forge = useForgeConfigurator({
    eggShopCfg: shop.eggShopCfg, embryoShopCfg: shop.embryoShopCfg,
    forgePrices: shop.forgePrices, shopGenes: shop.shopGenes,
    setShopBusy: shop.setShopBusy, toast, loadWallet: market.loadWallet,
    loadShopOrders: shop.loadShopOrders, requestBuy: purchase.requestBuy, t,
  });
  const prices = useAdminPrices({
    setLoadError, toast, loadShop: shop.loadShop,
    shopGeneDinos: shop.shopGeneDinos, t,
  });

  const { loadListed, loadWallet, loadMyItems, loadHistory } = market;
  const { loadShop, loadShopOrders } = shop;

  useEffect(() => { loadListed(); }, [loadListed]);
  useEffect(() => { loadWallet(); }, [loadWallet]);
  useEffect(() => {
    if (tab === "mine") loadMyItems();
    if (tab === "history") loadHistory();
    if (tab === "shop" || tab === "genes" || tab === "forge") loadShop();
    if (tab === "orders") loadShopOrders();
    if (tab === "prices") { loadShop(); prices.load(); }
    // prices.load is a stable useCallback (its only dep is a raw setter), so
    // it is deliberately not a dependency here: the effect must fire on a tab
    // change, not on a language change.
  }, [tab, loadMyItems, loadHistory, loadShop, loadShopOrders, prices.load]);

  // The catalogue is read on mount, not on first visit to the shop tab: the
  // egg/embryo tab only exists when one of those shops is enabled, and that
  // used to stay unknown until the player happened to open Shop or Genes.
  // The queued-purchase count is needed just as early -- it is the one thing
  // that asks for an action in game.
  useEffect(() => { loadShopOrders(); loadShop(); }, [loadShopOrders, loadShop]);

  const forgeEnabled = Boolean(shop.eggShopCfg?.enabled || shop.embryoShopCfg?.enabled);

  const items = useMemo<TabItem[]>(() => {
    const list: TabItem[] = [
      { id: "browse", label: t("market.tab.browse"), icon: Search },
      { id: "mine", label: t("market.tab.mine"), icon: Package },
      { id: "history", label: t("market.tab.history"), icon: History },
      { id: "shop", label: t("market.tab.shop"), icon: Store },
      { id: "genes", label: t("market.tab.genes"), icon: Dna },
    ];
    if (forgeEnabled) list.push({ id: "forge", label: t("market.tab.forge"), icon: Egg });
    if (isPanelUser) list.push({ id: "prices", label: t("market.tab.prices"), icon: Coins });
    list.push({
      id: "orders", label: t("market.tab.orders"), icon: Inbox,
      count: shop.shopPending > 0 ? shop.shopPending : undefined,
    });
    return list;
  }, [t, forgeEnabled, isPanelUser, shop.shopPending]);

  // The forge tab disappears when the operator turns both shops off: do not
  // leave the page showing a section that is no longer in the tab list.
  useEffect(() => {
    if (!items.some(i => i.id === tab)) setTab("browse");
  }, [items, tab]);

  /** Retry for the Alert: re-runs whatever the visible tab needs. */
  function reloadCurrentTab() {
    setLoadError("");
    if (tab === "browse") loadListed();
    else if (tab === "mine") loadMyItems();
    else if (tab === "history") loadHistory();
    else if (tab === "orders") loadShopOrders();
    else if (tab === "prices") { loadShop(); prices.load(); }
    else loadShop();
  }

  return (
    <MarketLayout embedded={embedded} wallet={market.wallet}>
      {loadError && (
        <Alert
          tone="danger"
          title={t("market.errors.loadTitle")}
          actions={
            <Button size="sm" icon={RotateCw} onClick={reloadCurrentTab}>
              {t("common.retry")}
            </Button>
          }
          onDismiss={() => setLoadError("")}
        >
          {loadError}
        </Alert>
      )}

      {shop.shopPending > 0 && tab !== "orders" && (
        <Alert
          tone="info"
          actions={
            <Button size="sm" onClick={() => setTab("orders")}>
              {t("market.tab.orders")}
            </Button>
          }
        >
          {t("market.shop.pendingHint", { n: shop.shopPending })}
        </Alert>
      )}

      {/* A load failure belongs to the section that raised it, so switching
          tabs drops it: keeping it up would offer a Retry that reloads
          something other than what failed. */}
      <Tabs
        label={t("market.tabsLabel")}
        items={items}
        value={tab}
        onChange={id => { setLoadError(""); setTab(id as TabKey); }}
      >
        {tab === "browse" && (
          <BrowseTab
            searchBp={market.searchBp}
            setSearchBp={market.setSearchBp}
            applySearchNow={market.applySearchNow}
            sort={market.sort}
            setSort={market.setSort}
            onRefresh={loadListed}
            loading={market.listedLoading}
            moreLoading={market.listedMoreLoading}
            listed={market.listed}
            listedTotal={market.listedTotal}
            wallet={market.wallet}
            onBuy={market.handleBuy}
            onLoadMore={market.loadMoreListed}
          />
        )}

        {tab === "mine" && (
          <MyItemsTab
            myStats={market.myStats}
            loading={market.myLoading}
            myItems={market.myItems}
            myBusyId={market.myBusyId}
            priceInput={market.priceInput}
            setPriceInput={market.setPriceInput}
            priceError={market.priceError}
            onList={market.handleList}
            onCancel={market.handleCancel}
          />
        )}

        {tab === "history" && (
          <HistoryTab loading={market.histLoading} history={market.history} />
        )}

        {tab === "shop" && (
          <ShopTab
            canOperate={canOperate}
            shopItems={shop.shopItems}
            shopVisible={shop.shopVisible}
            shopGroups={shop.shopGroups}
            shopCatCounts={shop.shopCatCounts}
            shopCatChips={shop.shopCatChips}
            shopCat={shop.shopCat}
            setShopCat={shop.setShopCat}
            shopSearch={shop.shopSearch}
            setShopSearch={shop.setShopSearch}
            shopLoading={shop.shopLoading}
            shopBusy={shop.shopBusy}
            openPack={shop.openPack}
            setOpenPack={shop.setOpenPack}
            onImport={shop.doImport}
            onBuy={shop.doBuy}
          />
        )}

        {tab === "genes" && (
          <GenesTab
            shopSearch={shop.shopSearch}
            setShopSearch={shop.setShopSearch}
            shopLoading={shop.shopLoading}
            shopGenes={shop.shopGenes}
            shopGeneDinos={shop.shopGeneDinos}
            geneSpecies={shop.geneSpecies}
            setGeneSpecies={shop.setGeneSpecies}
            geneTier={shop.geneTier}
            setGeneTier={shop.setGeneTier}
            shopBusy={shop.shopBusy}
            onBuy={shop.doBuy}
          />
        )}

        {tab === "forge" && (
          <ForgeTab
            forge={forge}
            eggShopCfg={shop.eggShopCfg}
            embryoShopCfg={shop.embryoShopCfg}
            shopGenes={shop.shopGenes}
            shopBusy={shop.shopBusy}
          />
        )}

        {tab === "prices" && isPanelUser && (
          <PricesTab
            prices={prices}
            shopGeneDinos={shop.shopGeneDinos}
            canOperate={canOperate}
          />
        )}

        {tab === "orders" && (
          <OrdersTab orders={shop.shopOrders} onRefresh={loadShopOrders} />
        )}
      </Tabs>

      <BuyConfirmModal
        pending={purchase.pendingBuy}
        busy={purchase.pendingBusy}
        error={purchase.pendingError}
        balance={market.wallet?.balance ?? null}
        onCancel={purchase.cancel}
        onConfirm={purchase.confirm}
      />
    </MarketLayout>
  );
}
