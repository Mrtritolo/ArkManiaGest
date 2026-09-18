/**
 * Points -- the one way a price is written on this page.
 *
 * Coins icon + tabular mono figure + a muted unit word. One notation
 * everywhere (MASTER section 10.5): no emoji coin, no bare number.
 */
import { Coins } from "lucide-react";
import { useTranslation } from "react-i18next";
import styles from "../MarketPage.module.css";

export function Points({ value, size = "md" }: { value: number; size?: "md" | "lg" }) {
  const { t } = useTranslation();
  return (
    <span className={size === "lg" ? `${styles.price} ${styles.priceLg}` : styles.price}>
      <Coins aria-hidden="true" />
      <span>{value.toLocaleString()}</span>
      <span className={styles.unit}>{t("market.pointsUnit")}</span>
    </span>
  );
}

/** Same figure with an explicit sign, for the transaction history. */
export function SignedPoints({ value, sign }: { value: number; sign: "+" | "-" }) {
  const { t } = useTranslation();
  return (
    <span className={styles.price}>
      <span>{sign}{value.toLocaleString()}</span>
      <span className={styles.unit}>{t("market.pointsUnit")}</span>
    </span>
  );
}
