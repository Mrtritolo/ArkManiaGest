/**
 * PrivacyPage.tsx — Public privacy policy (GDPR Art. 13/14 notice).
 *
 * Reachable at /privacy WITHOUT authentication (App.tsx renders it
 * before the auth state machine), because the notice must be readable
 * BEFORE the user logs in with Discord or panel credentials.
 *
 * All copy lives in i18n (en + it) under the `privacy.page.*` keys so
 * the operator's players read it in their own language.
 */
import { useTranslation } from "react-i18next";
import { ArrowLeft, ShieldCheck } from "lucide-react";

const SECTION_KEYS = ["controller", "data", "purposes", "retention", "rights", "cookies"] as const;

export default function PrivacyPage() {
  const { t } = useTranslation();

  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--bg, #f5f5f7)",
      padding: "clamp(0.75rem, 3vw, 1.5rem)",
    }}>
      <div style={{ maxWidth: 820, margin: "0 auto" }}>
        <a href="/" style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", fontSize: "0.85rem" }}>
          <ArrowLeft size={14} /> {t("privacy.page.back")}
        </a>

        <div className="card" style={{ marginTop: "0.75rem", padding: "clamp(1rem, 3vw, 2rem)" }}>
          <h1 style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "1.4rem" }}>
            <ShieldCheck size={22} /> {t("privacy.page.title")}
          </h1>
          <p style={{ fontSize: "0.8rem", opacity: 0.7 }}>{t("privacy.page.updated")}</p>
          <p style={{ whiteSpace: "pre-line", lineHeight: 1.6 }}>{t("privacy.page.intro")}</p>

          {SECTION_KEYS.map((key) => (
            <section key={key} style={{ marginTop: "1.25rem" }}>
              <h2 style={{ fontSize: "1.05rem" }}>{t(`privacy.page.${key}.title`)}</h2>
              <p style={{ whiteSpace: "pre-line", lineHeight: 1.6 }}>
                {t(`privacy.page.${key}.body`)}
              </p>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
