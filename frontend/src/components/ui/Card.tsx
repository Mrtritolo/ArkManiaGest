import { useId, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cx } from "./cx";
import "./Card.css";

export interface CardProps {
  title?: ReactNode;
  /** Default 'h2'. */
  titleAs?: "h2" | "h3";
  icon?: LucideIcon;
  /** Header end slot; wraps. */
  actions?: ReactNode;
  /** Form actions, 'View all', Pagination. */
  footer?: ReactNode;
  /** Body without padding: Table, lists, logs. */
  flush?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * Static surface. Never clickable and never reacts on hover: clickable tiles
 * are StatTile (href / onClick) or links.
 */
export function Card({ title, titleAs: Heading = "h2", icon: Icon, actions, footer, flush = false, className, children }: CardProps) {
  const titleId = useId();
  const hasTitle = title !== undefined;
  const hasHeader = hasTitle || actions !== undefined;
  const Root = hasTitle ? "section" : "div";

  return (
    <Root className={cx("ui-card", className)} aria-labelledby={hasTitle ? titleId : undefined}>
      {hasHeader && (
        <div className="ui-card__header">
          {Icon && <Icon className="ui-card__icon" aria-hidden="true" />}
          {hasTitle && (
            <Heading className="ui-card__title" id={titleId}>
              {title}
            </Heading>
          )}
          {actions !== undefined && <div className="ui-card__actions">{actions}</div>}
        </div>
      )}
      <div className={cx("ui-card__body", flush && "ui-card__body--flush")}>{children}</div>
      {footer !== undefined && <div className="ui-card__footer">{footer}</div>}
    </Root>
  );
}
