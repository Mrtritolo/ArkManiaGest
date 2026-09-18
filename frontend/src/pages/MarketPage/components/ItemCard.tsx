/**
 * ItemCard -- one marketplace listing.
 *
 * Static card: only the Buy button is clickable, so nothing here reacts on
 * hover (MASTER section 10.5). When Buy is unavailable the reason is written
 * next to it instead of hiding in a tooltip.
 */
import { useTranslation } from "react-i18next";
import { ShoppingBag } from "lucide-react";
import { Badge, Button } from "../../../components/ui";
import { arkItemDisplayName } from "../../../utils/arkItem";
import type { MarketListedItem } from "../../../services/api";
import { fmtRelative } from "../marketUtils";
import { ItemImage } from "./ItemImage";
import { Points } from "./Points";
import styles from "../MarketPage.module.css";

/**
 * ARK stat order on the level-up screen: HP / Stamina / Oxygen / Food /
 * Weight / MeleeDamage / MovementSpeed. Cryopods sometimes record 6 values
 * (no movement speed) and sometimes 7; whatever arrives is rendered.
 */
const STAT_KEYS = ["hp", "stamina", "oxygen", "food", "weight", "damage", "speed"];

export function ItemCard({
  it, walletBal, walletLoaded, onBuy,
}: {
  it: MarketListedItem;
  walletBal: number;
  walletLoaded: boolean;
  onBuy: () => void;
}) {
  const { t } = useTranslation();
  const baseName = arkItemDisplayName(it.blueprint);
  const isCryo = !!it.dino;
  // For cryopods the headline is the species + level.
  const display = isCryo && it.dino?.species
    ? (it.dino.level
        ? t("market.card.speciesLevel", { s: it.dino.species, lvl: it.dino.level })
        : it.dino.species)
    : baseName;
  const canAfford = walletLoaded && walletBal >= it.price;
  const stats = it.dino?.stats?.split(",").map(s => parseInt(s, 10)).filter(n => !isNaN(n)) ?? [];

  const blockedReason = !walletLoaded
    ? t("market.walletUnavailable")
    : !canAfford
      ? t("market.buyModal.insufficient")
      : null;

  return (
    <article className={styles.card}>
      <div className={styles.cardMedia}>
        {/* Cryopods show the creature, not the empty pod. */}
        <ItemImage
          blueprint={it.blueprint}
          nameOverride={isCryo && it.dino?.species ? it.dino.species : undefined}
        />
        <div className={styles.cardBadges}>
          <span>
            {it.is_blueprint && <Badge tone="accent">{t("market.card.blueprintShort")}</Badge>}
            {isCryo && it.dino?.gender && (
              <Badge>
                {it.dino.gender === "FEMALE" ? t("market.gender.female") : t("market.gender.male")}
              </Badge>
            )}
          </span>
          <span>
            {isCryo && it.dino?.level
              ? <Badge>{t("market.card.level", { n: it.dino.level })}</Badge>
              : it.quantity > 1
                ? <Badge>{t("market.card.quantity", { n: it.quantity })}</Badge>
                : null}
          </span>
        </div>
      </div>

      <div className={styles.cardBody}>
        <h2 className={styles.cardTitle}>{display}</h2>

        {isCryo && stats.length > 0 ? (
          <div className={styles.statGrid}>
            {stats.map((v, i) => (
              <div key={i} className={styles.stat}>
                <div className={styles.statLabel}>
                  {t(`market.stat.${STAT_KEYS[i] ?? "other"}`, { defaultValue: `S${i + 1}` })}
                </div>
                <div className={styles.statValue}>{v}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="l-cluster">
            {/* Neutral "Q{n}" until the integer quality to ASA tier mapping is
                confirmed (MASTER open question 1). */}
            {it.quality > 0 && <Badge>{t("market.card.quality", { n: it.quality })}</Badge>}
            {/* Durability as a percentage ONLY in the canonical 0-100 range:
                cryopods and some plugin-managed items store other data here. */}
            {it.durability > 0 && it.durability <= 100 && (
              <Badge>{t("market.card.durability", { n: Math.round(it.durability) })}</Badge>
            )}
            {it.rating > 0 && <Badge>{t("market.card.rating", { v: it.rating.toFixed(1) })}</Badge>}
          </div>
        )}

        <p className={`${styles.sellerLine} u-truncate`}
           title={it.owner_name || it.owner_eos_id}>
          {t("market.byShort")}{" "}
          <strong>{it.owner_name || it.owner_eos_id.slice(0, 8) + "…"}</strong>
          {it.listed_at && <> · {fmtRelative(it.listed_at, t)}</>}
        </p>

        <div className={styles.cardFooter}>
          <Points value={it.price} size="lg" />
          <Button
            variant="primary"
            size="sm"
            icon={ShoppingBag}
            disabled={blockedReason !== null}
            aria-label={t("market.buyAria", { item: display, price: it.price.toLocaleString() })}
            onClick={onBuy}
          >
            {t("market.buy")}
          </Button>
          {blockedReason && <span className={styles.buyNote}>{blockedReason}</span>}
        </div>
      </div>
    </article>
  );
}
