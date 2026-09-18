/**
 * OrdersTab -- what the player has bought from the server shop and still has
 * to collect in game.
 */
import { useTranslation } from "react-i18next";
import { CircleCheck, Inbox, RefreshCw, RotateCcw, type LucideIcon } from "lucide-react";
import { Badge, Button, EmptyState, Table, type BadgeTone } from "../../../components/ui";
import type { WebShopOrder } from "../../../services/api";
import { fmtRelative } from "../marketUtils";
import { Points } from "../components/Points";

const STATUS_TONE: Record<string, { tone: BadgeTone; icon: LucideIcon }> = {
  pending: { tone: "warning", icon: Inbox },
  claimed: { tone: "success", icon: CircleCheck },
  refunded: { tone: "neutral", icon: RotateCcw },
};

export function OrdersTab({ orders, onRefresh }: {
  orders: WebShopOrder[];
  onRefresh: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="l-stack">
      <div className="l-cluster">
        <Button variant="ghost" icon={RefreshCw} onClick={onRefresh}>
          {t("common.refresh")}
        </Button>
        <span className="u-muted u-text-sm">{t("market.shop.claimHint")}</span>
      </div>

      {orders.length === 0 ? (
        <EmptyState icon={Inbox} title={t("market.shop.noOrders")} />
      ) : (
        <Table label={t("market.tab.orders")} minWidth={640}>
          <thead>
            <tr>
              <th scope="col">{t("market.shop.col.what")}</th>
              <th scope="col">{t("market.shop.col.kind")}</th>
              <th scope="col" className="u-text-end">{t("market.shop.col.price")}</th>
              <th scope="col">{t("market.shop.col.status")}</th>
              <th scope="col">{t("market.shop.col.when")}</th>
            </tr>
          </thead>
          <tbody>
            {orders.map(o => {
              const status = STATUS_TONE[o.status] ?? { tone: "neutral" as BadgeTone, icon: Inbox };
              return (
                <tr key={o.id}>
                  <td className="ui-cell-wrap">
                    {o.gene_trait
                      ? t("market.shop.geneTierLabel", { name: o.gene_trait, tier: o.gene_tier })
                      : o.quantity > 1
                        ? `${o.item_key} ${t("market.card.quantity", { n: o.quantity })}`
                        : o.item_key}
                  </td>
                  <td>{t(`market.shop.kind.${o.kind}`, { defaultValue: o.kind })}</td>
                  <td className="u-text-end"><Points value={o.price} /></td>
                  <td>
                    <Badge tone={status.tone} icon={status.icon}>
                      {t(`market.shop.status.${o.status}`, { defaultValue: o.status })}
                    </Badge>
                    {o.last_error && (
                      <div className="u-text-sm u-secondary">
                        {t("market.shop.lastError", { v: o.last_error })}
                      </div>
                    )}
                  </td>
                  <td className="u-muted u-text-sm">
                    {fmtRelative(o.claimed_at || o.created_at, t)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </div>
  );
}
