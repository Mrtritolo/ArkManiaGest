import { forwardRef, type ButtonHTMLAttributes, type MouseEvent } from "react";
import type { LucideIcon } from "lucide-react";
import { cx } from "./cx";
import { Spinner } from "./Spinner";
import "./Button.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "disabled"> {
  /** Default 'secondary'. At most one primary per region (repeated Buy buttons excepted). */
  variant?: ButtonVariant;
  /** sm = --control-sm (28px), md = --control-md (32px admin, 40px in .ui-scope-player, 44px on touch). */
  size?: ButtonSize;
  /** Leading 16px icon, decorative. */
  icon?: LucideIcon;
  /** Spinner replaces the icon; aria-busy + aria-disabled; clicks are swallowed. */
  loading?: boolean;
  /** Text shown while loading, e.g. t('common.saving'). Shares one grid cell with children. */
  loadingLabel?: string;
  /** aria-disabled + click guard. The button stays focusable and discoverable. */
  disabled?: boolean;
  /** Toggle / filter-chip state -> aria-pressed. */
  pressed?: boolean;
}

/** Class list for an <a> or router <Link> that must look like a button. */
export function buttonClass(opts: { variant?: ButtonVariant; size?: ButtonSize } = {}): string {
  const { variant = "secondary", size = "md" } = opts;
  return cx("ui-btn", `ui-btn--${variant}`, size === "sm" && "ui-btn--sm");
}

/**
 * The single labelled action button. Never uses the native `disabled`
 * attribute: a disabled or loading button keeps keyboard focus, and the click
 * guard also cancels implicit form submission.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    icon: Icon,
    loading = false,
    loadingLabel,
    disabled = false,
    pressed,
    type = "button",
    className,
    children,
    onClick,
    ...rest
  },
  ref,
) {
  const blocked = disabled || loading;
  const swapText = loading && loadingLabel !== undefined;

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
      className={cx(buttonClass({ variant, size }), className)}
      aria-disabled={blocked || undefined}
      aria-busy={loading || undefined}
      aria-pressed={pressed}
      onClick={handleClick}
    >
      {loading ? <Spinner /> : Icon ? <Icon aria-hidden="true" /> : null}
      <span className="ui-btn__label">
        <span data-inactive={swapText || undefined}>{children}</span>
        {loadingLabel !== undefined && (
          <span data-inactive={!swapText || undefined}>{loadingLabel}</span>
        )}
        {/* Toggle buttons: a hidden bold copy reserves the pressed width. */}
        {pressed !== undefined && (
          <span data-inactive="" data-reserve="" aria-hidden="true">
            {children}
          </span>
        )}
      </span>
    </button>
  );
});
