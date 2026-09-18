import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { CircleAlert, CircleCheck, TriangleAlert, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import "./StatTile.css";

export interface StatTileProps {
  label: string;
  /** 24px/600 tabular. */
  value: ReactNode;
  icon?: LucideIcon;
  /** Muted suffix, e.g. '/ 70'. */
  unit?: string;
  /** 13px line under the value. With metaTone it is the problem statement ('1 crashed'). */
  meta?: ReactNode;
  /** Problem state: status colour + icon, never colour alone. */
  metaTone?: "success" | "warning" | "danger";
  loading?: boolean;
  /** The whole tile is a react-router <Link>. */
  href?: string;
  /** The whole tile is a <button> (filter tile). */
  onClick?: () => void;
  /** With onClick -> aria-pressed. */
  pressed?: boolean;
}

const META_ICONS: Record<NonNullable<StatTileProps["metaTone"]>, LucideIcon> = {
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
};

/**
 * KPI tile. Static tiles are a <div>; only link and button tiles react on
 * hover. The accessible name of an interactive tile reads 'Players online 42'.
 */
export function StatTile({ label, value, icon: Icon, unit, meta, metaTone, loading = false, href, onClick, pressed }: StatTileProps) {
  const { t } = useTranslation();
  const MetaIcon = metaTone ? META_ICONS[metaTone] : null;

  const content = (
    <>
      <span className="ui-stat__label">
        {Icon && <Icon aria-hidden="true" />}
        {label}
      </span>
      <span className="ui-stat__value">
        {loading ? (
          <>
            <span aria-hidden="true">--</span>
            <span className="u-sr-only">{t("common.loading")}</span>
          </>
        ) : (
          value
        )}
        {unit !== undefined && !loading && <span className="ui-stat__unit"> {unit}</span>}
      </span>
      {meta !== undefined && (
        <span className={metaTone ? `ui-stat__meta ui-stat__meta--${metaTone}` : "ui-stat__meta"}>
          {MetaIcon && <MetaIcon aria-hidden="true" />}
          {meta}
        </span>
      )}
    </>
  );

  if (href !== undefined) {
    return (
      <Link to={href} className="ui-stat ui-stat--interactive" aria-busy={loading || undefined}>
        {content}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button
        type="button"
        className="ui-stat ui-stat--interactive"
        aria-pressed={pressed}
        aria-busy={loading || undefined}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }
  return (
    <div className="ui-stat" aria-busy={loading || undefined}>
      {content}
    </div>
  );
}
