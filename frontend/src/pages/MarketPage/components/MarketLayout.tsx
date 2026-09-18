/**
 * MarketLayout -- the page shell in both render modes.
 *
 * Declared at module scope on purpose: the previous version built this
 * component inside the page's render body, so React saw a new component type
 * on every keystroke, remounted the whole tree and dropped input focus after
 * one character.
 *
 * Standalone (a Discord player, no sidebar) is the page's own <main> and opts
 * into the roomier player density; embedded in the admin shell it is a plain
 * block that keeps the admin scale.
 */
import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowLeft, Coins, ShoppingBag } from "lucide-react";
import { buttonClass, PageHeader } from "../../../components/ui";
import type { MarketWallet } from "../../../services/api";
import styles from "../MarketPage.module.css";

export function MarketLayout({
  embedded, wallet, children,
}: {
  embedded: boolean;
  wallet: MarketWallet | null;
  children: ReactNode;
}) {
  const { t } = useTranslation();

  // Player density for the standalone page, on <body> so the buy dialog, the
  // confirms and the toasts portaled there inherit it too (MASTER section 5).
  useEffect(() => {
    if (embedded) return;
    document.body.classList.add("ui-scope-player");
    return () => document.body.classList.remove("ui-scope-player");
  }, [embedded]);

  const header = (
    <PageHeader
      title={t("market.title")}
      icon={ShoppingBag}
      description={t("market.subtitle")}
      actions={
        <>
          {!embedded && (
            <Link to="/" className={buttonClass({ variant: "secondary" })}>
              <ArrowLeft aria-hidden="true" />
              {t("market.backToDashboard")}
            </Link>
          )}
          {wallet && (
            <span className={styles.wallet} title={t("market.pointsHint")}>
              <Coins aria-hidden="true" />
              <span className="u-sr-only">{t("market.walletLabel")} </span>
              {wallet.balance.toLocaleString()}
              <span className="u-sr-only"> {t("market.pointsUnitLong")}</span>
            </span>
          )}
        </>
      }
    />
  );

  if (embedded) {
    return (
      <div className="l-page">
        {header}
        {children}
      </div>
    );
  }
  return (
    <main id="main-content" tabIndex={-1} className="l-page">
      {header}
      {children}
    </main>
  );
}
