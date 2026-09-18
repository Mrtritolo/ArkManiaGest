import { forwardRef, useId, type ReactNode } from "react";
import { cx } from "./cx";
import "./Switch.css";

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Always rendered (visibly or, with hideLabel, for assistive technology only): never empty. */
  label: Exclude<ReactNode, null | undefined | boolean>;
  /** Table cells: the label stays as the accessible name ('Enable Rex'). */
  hideLabel?: boolean;
  description?: ReactNode;
  /** aria-disabled + guard; stays focusable. */
  disabled?: boolean;
  id?: string;
  /** Goes on the outermost rendered element, like every kit control: here the row <span>. */
  className?: string;
}

/**
 * Immediate on/off setting: <button role="switch">, named by its <label>.
 * The ref is the switch button (e.g. to focus it after a failed save).
 */
export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { checked, onChange, label, hideLabel = false, description, disabled = false, id, className },
  ref,
) {
  const autoId = useId();
  const switchId = id ?? autoId;
  const descId = `${switchId}-desc`;

  return (
    <span className={cx("ui-switch-row", hideLabel && "ui-switch-row--bare", className)}>
      <span className={cx("ui-switch-row__text", hideLabel && "u-sr-only")}>
        <label className="ui-switch-row__label" htmlFor={switchId}>
          {label}
        </label>
        {description !== undefined && (
          <span className="ui-switch-row__desc" id={descId}>
            {description}
          </span>
        )}
      </span>
      <button
        ref={ref}
        type="button"
        role="switch"
        id={switchId}
        className="ui-switch"
        aria-checked={checked}
        aria-disabled={disabled || undefined}
        aria-describedby={description !== undefined ? descId : undefined}
        onClick={() => {
          if (!disabled) onChange(!checked);
        }}
      >
        <span className="ui-switch__thumb" aria-hidden="true" />
      </button>
    </span>
  );
});
