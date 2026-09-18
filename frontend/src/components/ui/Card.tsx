import { useId, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cx } from "./cx";
import "./Card.css";

export interface CardProps {
  title?: ReactNode;
  /** Default 'h2'. */
  titleAs?: "h2" | "h3";
  icon?: LucideIcon;
  /** Header end slot; wraps. `canOperate && <Button/>` is fine: false renders no header slot. */
  actions?: ReactNode;
  /** Form actions, 'View all', Pagination. */
  footer?: ReactNode;
  /** Body without padding: Table, lists, logs. */
  flush?: boolean;
  /** Root id, e.g. the target of a disclosure button's aria-controls. */
  id?: string;
  /**
   * Grid placement only, e.g. 'u-span-full'. Not a layout hook: the utilities
   * layer beats the ui layer, so an `l-*` class here overrides the card's own
   * header / body / footer flex and pulls them apart.
   */
  className?: string;
  children: ReactNode;
}

/**
 * A slot is filled only by something that renders, so the common
 * `actions={canOperate && <Button/>}` leaves no empty box for a viewer.
 */
function present(node: ReactNode): boolean {
  return node != null && node !== "" && typeof node !== "boolean";
}

/**
 * Static surface. Never clickable and never reacts on hover: clickable tiles
 * are StatTile (href / onClick) or links.
 */
export function Card({ title, titleAs: Heading = "h2", icon: Icon, actions, footer, flush = false, id, className, children }: CardProps) {
  const titleId = useId();
  const hasTitle = present(title);
  const hasActions = present(actions);
  const hasHeader = hasTitle || hasActions;
  const Root = hasTitle ? "section" : "div";

  return (
    <Root id={id} className={cx("ui-card", className)} aria-labelledby={hasTitle ? titleId : undefined}>
      {hasHeader && (
        <div className="ui-card__header">
          {Icon && <Icon className="ui-card__icon" aria-hidden="true" />}
          {hasTitle && (
            <Heading className="ui-card__title" id={titleId}>
              {title}
            </Heading>
          )}
          {hasActions && <div className="ui-card__actions">{actions}</div>}
        </div>
      )}
      <div className={cx("ui-card__body", flush && "ui-card__body--flush")}>{children}</div>
      {present(footer) && <div className="ui-card__footer">{footer}</div>}
    </Root>
  );
}
