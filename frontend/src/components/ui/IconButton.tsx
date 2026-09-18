import { forwardRef, type ButtonHTMLAttributes, type MouseEvent } from "react";
import type { LucideIcon } from "lucide-react";
import { cx } from "./cx";
import { Spinner } from "./Spinner";
import "./IconButton.css";

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "disabled" | "aria-label"> {
  icon: LucideIcon;
  /** Required accessible name, also the hover title. Verb + object: 'Restart The Island'. */
  label: string;
  /** sm 28px (row actions, toasts, dialog close), md 32px (toolbars); 44px on touch. */
  size?: "sm" | "md";
  /** Danger tint on hover/focus for destructive actions; the label still carries the meaning. */
  tone?: "danger";
  loading?: boolean;
  /** aria-disabled + click guard; stays focusable and visible. */
  disabled?: boolean;
  pressed?: boolean;
}

/**
 * Icon-only action. aria-expanded / aria-controls pass through for
 * disclosure toggles (a ChevronDown / ChevronRight icon rotates when open).
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    icon: Icon,
    label,
    size = "md",
    tone,
    loading = false,
    disabled = false,
    pressed,
    type = "button",
    className,
    onClick,
    title,
    ...rest
  },
  ref,
) {
  const blocked = disabled || loading;

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (blocked) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  }

  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={cx(
        "ui-icon-btn",
        size === "sm" && "ui-icon-btn--sm",
        tone === "danger" && "ui-icon-btn--danger",
        className,
      )}
      aria-label={label}
      title={title ?? label}
      aria-disabled={blocked || undefined}
      aria-busy={loading || undefined}
      aria-pressed={pressed}
      onClick={handleClick}
    >
      {loading ? <Spinner /> : <Icon aria-hidden="true" />}
    </button>
  );
});
