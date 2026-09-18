import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "./IconButton";
import "./Alert.css";

export type AlertTone = "info" | "success" | "warning" | "danger";

export interface AlertProps {
  tone: AlertTone;
  title?: ReactNode;
  /** Detail under the title. An empty string, null or false is "no detail": no empty body is rendered. */
  children?: ReactNode;
  /** Button size="sm" secondary/ghost, e.g. Retry. `canRetry && <Button/>` is fine: false renders no row. */
  actions?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}

/**
 * A slot is filled only by something that renders. `cond && <Button/>`,
 * `null` and `''` (an error with no detail) must not leave an empty box.
 */
function present(node: ReactNode): boolean {
  return node != null && node !== "" && typeof node !== "boolean";
}

const ICONS: Record<AlertTone, LucideIcon> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
};

/** i18n key suffix of the screen-reader tone prefix. */
const TONE_KEY: Record<AlertTone, string> = { info: "info", success: "success", warning: "warning", danger: "error" };

/**
 * Persistent inline message: load errors with Retry, warnings, notes, errors
 * inside a dialog. Only tone="danger" is a live region (role="alert").
 */
export function Alert({ tone, title, children, actions, onDismiss, className }: AlertProps) {
  const { t } = useTranslation();
  const Icon = ICONS[tone];
  const prefix = <span className="u-sr-only">{t(`ui.tone.${TONE_KEY[tone]}`)} </span>;
  const hasTitle = present(title);

  return (
    <div
      className={className ? `ui-alert ui-alert--${tone} ${className}` : `ui-alert ui-alert--${tone}`}
      role={tone === "danger" ? "alert" : undefined}
    >
      <Icon className="ui-alert__icon" aria-hidden="true" />
      <div className="ui-alert__content">
        {hasTitle && (
          <div className="ui-alert__title">
            {prefix}
            {title}
          </div>
        )}
        {present(children) && (
          <div className="ui-alert__body">
            {!hasTitle && prefix}
            {children}
          </div>
        )}
        {present(actions) && <div className="ui-alert__actions">{actions}</div>}
      </div>
      {onDismiss && <IconButton size="sm" icon={X} label={t("ui.dismiss")} onClick={onDismiss} />}
    </div>
  );
}
