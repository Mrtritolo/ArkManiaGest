/**
 * HistoryTab -- the last transactions where the player was buyer or seller.
 */
import { useTranslation } from "react-i18next";
import { History, ShoppingBag, Tag } from "lucide-react";
import { Badge, EmptyState, Spinner, Table } from "../../../components/ui";
import { arkItemDisplayName } from "../../../utils/arkItem";
import type { MarketTransaction } from "../../../services/api";
import { fmtRelative } from "../marketUtils";
import { SignedPoints } from "../components/Points";

export function HistoryTab({ loading, history }: {
  loading: boolean;
  history: MarketTransaction[];
}) {
  const { t } = useTranslation();

  if (loading && history.length === 0) return <Spinner block label={t("common.loading")} />;
  if (history.length === 0) return <EmptyState icon={History} title={t("market.noHistory")} />;

  return (
    <Table label={t("market.tab.history")} minWidth={680}>
      <thead>
        <tr>
          <th scope="col">{t("market.col.when")}</th>
          <th scope="col">{t("market.col.role")}</th>
          <th scope="col">{t("market.col.item")}</th>
          <th scope="col">{t("market.col.counter")}</th>
          <th scope="col" className="u-text-end">{t("market.col.price")}</th>
        </tr>
      </thead>
      <tbody>
        {history.map(tx => {
          const bought = tx.role === "buyer";
          return (
            <tr key={tx.id}>
              <td className="u-text-sm">{fmtRelative(tx.created_at, t)}</td>
              <td>
                <Badge tone={bought ? "warning" : "success"} icon={bought ? ShoppingBag : Tag}>
                  {bought ? t("market.bought2") : t("market.sold")}
                </Badge>
              </td>
              <td className="ui-cell-wrap">
                {tx.blueprint ? arkItemDisplayName(tx.blueprint) : t("market.unknownItem")}
              </td>
              <td className="u-text-sm">
                {tx.counterpart_name || tx.counterpart_eos.slice(0, 8) + "…"}
              </td>
              <td className="u-text-end">
                <SignedPoints value={tx.price} sign={bought ? "-" : "+"} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
