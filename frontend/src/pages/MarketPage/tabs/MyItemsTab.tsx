/**
 * MyItemsTab -- what the player owns on the market: drafts waiting for a
 * price, live listings, and items bought that still need /market claim.
 */
import { useTranslation } from "react-i18next";
import {
  Ban, CircleCheck, FileText, Inbox, Package, Tag, type LucideIcon,
} from "lucide-react";
import {
  Badge, Button, EmptyState, Input, NotAvailable, Spinner, StatTile, Table,
  type BadgeTone,
} from "../../../components/ui";
import { arkItemDisplayName } from "../../../utils/arkItem";
import type { MarketMyItem } from "../../../services/api";
import { ItemImage } from "../components/ItemImage";
import { Points } from "../components/Points";
import styles from "../MarketPage.module.css";

const STATUS: Record<string, { tone: BadgeTone; icon: LucideIcon }> = {
  draft: { tone: "neutral", icon: FileText },
  listed: { tone: "success", icon: Tag },
  sold: { tone: "warning", icon: Inbox },
  claimed: { tone: "info", icon: CircleCheck },
};

export interface MyItemsTabProps {
  myStats: { draft: number; listed: number; sold: number; claimed: number };
  loading: boolean;
  myItems: MarketMyItem[];
  myBusyId: number | null;
  priceInput: Record<number, string>;
  setPriceInput: (update: (prev: Record<number, string>) => Record<number, string>) => void;
  priceError: Record<number, string>;
  onList: (id: number) => void;
  onCancel: (id: number) => void;
}

export function MyItemsTab({
  myStats, loading, myItems, myBusyId, priceInput, setPriceInput, priceError,
  onList, onCancel,
}: MyItemsTabProps) {
  const { t } = useTranslation();

  return (
    <div className="l-stack">
      <div className="l-grid--stats">
        <StatTile label={t("market.stats.draft")} value={myStats.draft} icon={FileText} />
        <StatTile label={t("market.stats.listed")} value={myStats.listed} icon={Tag} />
        <StatTile label={t("market.stats.sold")} value={myStats.sold} icon={Inbox} />
        <StatTile label={t("market.stats.claimed")} value={myStats.claimed} icon={CircleCheck} />
      </div>

      {loading && myItems.length === 0 ? (
        <Spinner block label={t("common.loading")} />
      ) : myItems.length === 0 ? (
        <EmptyState icon={Package} title={t("market.noMine")} />
      ) : (
        <Table label={t("market.tab.mine")} minWidth={720}>
          <thead>
            <tr>
              <th scope="col">{t("market.col.item")}</th>
              <th scope="col">{t("market.col.role")}</th>
              <th scope="col">{t("market.col.status")}</th>
              <th scope="col" className="u-text-end">{t("market.col.price")}</th>
              <th scope="col"><span className="u-sr-only">{t("market.col.actions")}</span></th>
            </tr>
          </thead>
          <tbody>
            {myItems.map(it => {
              const status = STATUS[it.status] ?? { tone: "neutral" as BadgeTone, icon: Package };
              const errId = `market-price-error-${it.id}`;
              const error = priceError[it.id];
              return (
                <tr key={it.id}>
                  <td>
                    <div className={styles.cellItem}>
                      <ItemImage blueprint={it.blueprint} className={styles.cellThumb} />
                      <div className="ui-cell-2">
                        <div>{arkItemDisplayName(it.blueprint)}</div>
                        <div className="u-muted u-text-sm">
                          {t("market.qty", { n: it.quantity })}
                          {it.quality > 0 ? ` · ${t("market.card.quality", { n: it.quality })}` : ""}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <Badge>{t(`market.role.${it.role}`, { defaultValue: it.role })}</Badge>
                  </td>
                  <td>
                    <Badge tone={status.tone} icon={status.icon}>
                      {t(`market.status.${it.status}`, { defaultValue: it.status })}
                    </Badge>
                  </td>
                  <td className="u-text-end">
                    {it.price > 0 ? <Points value={it.price} /> : <NotAvailable />}
                  </td>
                  <td>
                    {it.role === "owner" && it.status === "draft" && (
                      <div className={styles.rowForm}>
                        <span>
                          <Input
                            size="sm" type="number" min={1} inputMode="numeric" mono
                            className={styles.priceCell}
                            aria-label={t("market.priceForItem", { name: arkItemDisplayName(it.blueprint) })}
                            aria-invalid={error ? true : undefined}
                            aria-describedby={error ? errId : undefined}
                            placeholder={t("market.col.price")}
                            value={priceInput[it.id] ?? ""}
                            onChange={e => setPriceInput(p => ({ ...p, [it.id]: e.target.value }))}
                          />
                          {/* role="alert": Publish keeps focus on the button,
                              so the refusal has to announce itself. */}
                          {error && (
                            <span className={styles.rowError} id={errId} role="alert">
                              {error}
                            </span>
                          )}
                        </span>
                        <Button
                          variant="primary" size="sm" icon={Tag}
                          loading={myBusyId === it.id}
                          loadingLabel={t("market.publishing")}
                          disabled={myBusyId !== null}
                          onClick={() => onList(it.id)}
                        >
                          {t("market.publish")}
                        </Button>
                      </div>
                    )}
                    {it.role === "owner" && it.status === "listed" && (
                      <div className={styles.rowForm}>
                        <Button
                          variant="danger" size="sm" icon={Ban}
                          loading={myBusyId === it.id}
                          loadingLabel={t("market.cancelling")}
                          disabled={myBusyId !== null}
                          onClick={() => onCancel(it.id)}
                        >
                          {t("market.cancel")}
                        </Button>
                      </div>
                    )}
                    {it.status === "sold" && it.role === "buyer" && (
                      <span className="u-text-sm u-secondary">{t("market.useClaim")}</span>
                    )}
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
