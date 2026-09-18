import { useTranslation } from "react-i18next";
import "./Badge.css";

export type QualityTier = "primitive" | "ramshackle" | "apprentice" | "journeyman" | "mastercraft" | "ascendant";

export interface QualityBadgeProps {
  tier: QualityTier;
}

/**
 * ASA item-quality chip on the dedicated --color-quality-* tokens. The tier
 * name is always written: apprentice/journeyman and ramshackle/mastercraft
 * are close under colour-vision deficiency.
 */
export function QualityBadge({ tier }: QualityBadgeProps) {
  const { t } = useTranslation();
  return (
    <span className="ui-quality" data-tier={tier}>
      <span className="u-sr-only">{t("ui.quality.label")} </span>
      <span className="ui-quality__marker" aria-hidden="true" />
      {t(`ui.quality.${tier}`)}
    </span>
  );
}
