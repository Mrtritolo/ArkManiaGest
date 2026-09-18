import { forwardRef, type SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cx } from "./cx";
import { useFieldControl } from "./Field";
import "./Field.css";

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  size?: "sm" | "md";
  /** Goes on the outermost rendered element, like every kit control: here the wrapper <span>. */
  className?: string;
}

/**
 * Native <select> styled like Input. Children are <option>s. The option list
 * follows the theme through color-scheme. Booleans use Switch instead.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { size = "md", className, children, ...rest },
  ref,
) {
  const a11y = useFieldControl(rest, "Select");
  return (
    <span className={cx("ui-select", className)}>
      <select
        {...rest}
        {...a11y}
        ref={ref}
        className={cx("ui-control", size === "sm" && "ui-control--sm")}
      >
        {children}
      </select>
      <ChevronDown className="ui-select__chevron" aria-hidden="true" />
    </span>
  );
});
