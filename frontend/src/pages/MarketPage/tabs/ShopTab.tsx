/**
 * ShopTab -- the server shop: the ArkShop catalogue imported into the web
 * window, grouped by category, with the bundle contents one click away.
 */
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, RefreshCw, Search, ShoppingBag } from "lucide-react";
import { Badge, Button, EmptyState, Input, Spinner } from "../../../components/ui";
import { arkItemDisplayName } from "../../../utils/arkItem";
import type { WebShopItem } from "../../../services/api";
import { LineThumb, ShopThumb } from "../components/ShopThumbs";
import { Points } from "../components/Points";
import styles from "../MarketPage.module.css";

export interface ShopTabProps {
  canOperate: boolean;
  shopItems: WebShopItem[];
  shopVisible: WebShopItem[];
  shopGroups: readonly (readonly [string, WebShopItem[]])[];
  shopCatCounts: Record<string, number>;
  shopCatChips: string[];
  shopCat: string;
  setShopCat: (value: string) => void;
  shopSearch: string;
  setShopSearch: (value: string) => void;
  shopLoading: boolean;
  shopBusy: string | null;
  openPack: string | null;
  setOpenPack: (key: string | null) => void;
  onImport: () => void;
  onBuy: (kind: "item" | "dino", key: string, label: string, price: number) => void;
}

export function ShopTab({
  canOperate, shopItems, shopVisible, shopGroups, shopCatCounts, shopCatChips,
  shopCat, setShopCat, shopSearch, setShopSearch, shopLoading, shopBusy,
  openPack, setOpenPack, onImport, onBuy,
}: ShopTabProps) {
  const { t } = useTranslation();
  const totalCount = Object.values(shopCatCounts).reduce((a, b) => a + b, 0);

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
        {/* Operator only: fills the web window from the ArkShop config. It
            lives here, not in a settings page, because this is where you
            notice the window is empty. */}
        {canOperate && (
          <Button
            icon={RefreshCw}
            loading={shopBusy === "__import"}
            loadingLabel={t("market.shop.importing")}
            disabled={shopBusy !== null}
            title={t("market.shop.importHint")}
            onClick={onImport}
          >
            {t("market.shop.import")}
          </Button>
        )}
        {/* Refetch: the catalogue below stays visible, this says it is
            working. Same contract as the browse tab. */}
        {shopLoading && shopItems.length > 0 && <Spinner label={t("common.loading")} />}
      </div>

      {/* Category filter. The counts follow the search, so a category the
          search emptied is visible at once. */}
      {shopItems.length > 0 && (
        <div className="l-cluster" role="group" aria-label={t("market.shop.catFilter")}>
          <Button size="sm" pressed={!shopCat} onClick={() => setShopCat("")}>
            {t("market.shop.catAll")} <span className="ui-count">{totalCount}</span>
          </Button>
          {shopCatChips.map(c => (
            <Button key={c} size="sm" pressed={shopCat === c}
              onClick={() => setShopCat(shopCat === c ? "" : c)}>
              {t(`market.shop.cat.${c}`, { defaultValue: c })}{" "}
              <span className="ui-count">{shopCatCounts[c]}</span>
            </Button>
          ))}
        </div>
      )}

      {shopLoading && shopItems.length === 0 ? (
        <Spinner block label={t("common.loading")} />
      ) : shopItems.length === 0 ? (
        <EmptyState icon={Search} title={t("market.shop.emptyItems")} />
      ) : shopVisible.length === 0 ? (
        <EmptyState
          icon={Search}
          title={t("market.shop.noMatch")}
          action={
            <Button size="sm" onClick={() => { setShopSearch(""); setShopCat(""); }}>
              {t("market.shop.clearFilters")}
            </Button>
          }
        />
      ) : (
        shopGroups.map(([cat, items]) => (
          <section key={cat}>
            <h2 className={styles.groupHeading}>
              {t(`market.shop.cat.${cat}`, { defaultValue: cat })}
              <span className="ui-count">{items.length}</span>
            </h2>
            <div className="l-grid--cards">
              {items.map(i => (
                <ShopEntryCard
                  key={i.key}
                  entry={i}
                  busy={shopBusy}
                  open={openPack === i.key}
                  onToggle={() => setOpenPack(openPack === i.key ? null : i.key)}
                  onBuy={() => onBuy(i.kind, i.key, i.label, i.price)}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function ShopEntryCard({
  entry, busy, open, onToggle, onBuy,
}: {
  entry: WebShopItem;
  busy: string | null;
  open: boolean;
  onToggle: () => void;
  onBuy: () => void;
}) {
  const { t } = useTranslation();
  const panelId = useId();
  const isPack = entry.line_count > 1;

  return (
    <div className={styles.shopCard}>
      <div className={styles.shopCardHead}>
        <ShopThumb entry={entry} />
        <div className={styles.shopCardText}>
          <div className={styles.shopCardName}>{entry.label}</div>
          <div className="u-muted u-text-sm">
            {entry.kind === "dino"
              ? t("market.shop.dinoLevel", { lvl: entry.dino_level })
              : isPack
                ? t("market.shop.pieces", { n: entry.line_count })
                : t("market.card.quantity", { n: entry.quantity })}
            {entry.is_blueprint ? ` · ${t("market.card.blueprintShort")}` : ""}
          </div>
          {entry.kind === "dino" && (
            <div className="u-muted u-text-sm">{t("market.shop.dinoInPod")}</div>
          )}
        </div>
      </div>

      {/* The bundle contents: closed, because a 31-line kit would bury the
          grid, but one click away, because buying without knowing what is
          inside is not buying. */}
      {isPack && (
        <div>
          <Button
            variant="ghost"
            size="sm"
            icon={ChevronDown}
            aria-expanded={open}
            aria-controls={panelId}
            onClick={onToggle}
          >
            {open ? t("market.shop.hideContent") : t("market.shop.showContent")}
          </Button>
          {open && (
            <div className={styles.packList} id={panelId}>
              {entry.lines.map((ln, idx) => (
                <div key={idx} className={styles.packLine}>
                  <LineThumb blueprint={ln.blueprint} />
                  <span className={`${styles.packLineName} u-truncate`}>
                    {arkItemDisplayName(ln.blueprint)}
                  </span>
                  <span className="u-mono u-muted u-num">
                    {t("market.card.quantity", { n: ln.amount })}
                  </span>
                  {ln.is_blueprint && <Badge tone="accent">{t("market.card.blueprintShort")}</Badge>}
                  {ln.quality > 0 && <Badge>{t("market.card.quality", { n: ln.quality })}</Badge>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className={styles.cardFooter}>
        <Points value={entry.price} />
        <Button
          variant="primary"
          size="sm"
          icon={ShoppingBag}
          loading={busy === entry.key}
          loadingLabel={t("market.buyModal.buying")}
          disabled={busy !== null}
          aria-label={t("market.buyAria", { item: entry.label, price: entry.price.toLocaleString() })}
          onClick={onBuy}
        >
          {t("market.shop.buy")}
        </Button>
      </div>
    </div>
  );
}
