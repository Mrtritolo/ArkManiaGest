import { useId } from "react";
import { cx } from "./cx";
import "./SegmentedControl.css";

export interface SegmentedOption<V extends string> {
  value: V;
  label: string;
}

export interface SegmentedControlProps<V extends string> {
  /** Group name, rendered as a visually hidden <legend>. */
  label: string;
  options: ReadonlyArray<SegmentedOption<V>>;
  value: V;
  onChange: (value: V) => void;
  size?: "sm" | "md";
  className?: string;
}

/**
 * Single choice from 2-5 short options, built on native radios: one tab stop,
 * arrow keys and checked state come from the platform.
 */
export function SegmentedControl<V extends string>({
  label,
  options,
  value,
  onChange,
  size = "md",
  className,
}: SegmentedControlProps<V>) {
  const name = useId();
  return (
    <fieldset className={cx("ui-seg", size === "sm" && "ui-seg--sm", className)}>
      <legend className="u-sr-only">{label}</legend>
      {options.map(option => (
        <label key={option.value} className="ui-seg__option">
          <input
            type="radio"
            className="ui-seg__input"
            name={name}
            value={option.value}
            checked={option.value === value}
            onChange={() => onChange(option.value)}
          />
          <span className="ui-seg__label">
            {/* The hidden bold copy reserves the checked width: no jump. */}
            <span className="ui-bold-stable">
              <span>{option.label}</span>
              <span className="ui-bold-stable__reserve" aria-hidden="true">
                {option.label}
              </span>
            </span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
