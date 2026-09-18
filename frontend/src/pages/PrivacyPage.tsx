/**
 * PrivacyPage.tsx — Public privacy policy (GDPR Art. 13/14 notice).
 *
 * Reachable at /privacy WITHOUT authentication (App.tsx renders it
 * before the auth state machine), because the notice must be readable
 * BEFORE the user logs in with Discord or panel credentials.
 *
 * It renders outside the router and outside the toast / confirm providers,
 * so the back link is a plain <a> and the page paints its own canvas.
 *
 * All copy lives in i18n (en + it) under the `privacy.page.*` keys so
 * the operator's players read it in their own language.
 */
import { useTranslation } from "react-i18next";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Card } from "../components/ui";
import styles from "./PrivacyPage.module.css";

const SECTION_KEYS = ["controller", "data", "purposes", "retention", "rights", "cookies"] as const;

export default function PrivacyPage() {
  const { t } = useTranslation();

  return (
    <div className={styles.root}>
      <main id="main-content" tabIndex={-1} className={styles.page}>
        <a href="/" className={styles.back}>
          <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
          {t("privacy.page.back")}
        </a>

        <Card>
          <div className="l-stack">
            <div className="l-stack l-stack--sm">
              <h1 className={styles.title}>
                <ShieldCheck size={20} strokeWidth={1.75} aria-hidden="true" />
                {t("privacy.page.title")}
              </h1>
              <p className="u-muted u-text-sm">{t("privacy.page.updated")}</p>
            </div>

            <p className={styles.prose}>{t("privacy.page.intro")}</p>

            {SECTION_KEYS.map(key => (
              <section key={key} className={styles.section}>
                <h2>{t(`privacy.page.${key}.title`)}</h2>
                <p className={styles.prose}>{t(`privacy.page.${key}.body`)}</p>
              </section>
            ))}
          </div>
        </Card>
      </main>
    </div>
  );
}
