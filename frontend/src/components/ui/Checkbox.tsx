import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { cx } from "./cx";
import "./Checkbox.css";

type NativeProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size">;

/** A label that is always rendered: `cond && t('x')` or `undefined` needs the aria-label branch. */
type VisibleLabel = Exclude<ReactNode, null | undefined | boolean>;

export type CheckboxProps = NativeProps & {
  /** Default 'checkbox'. Radios in a group share `name`. */
  type?: "checkbox" | "radio";
  /** Checkbox only: the mixed state of a select-all header. */
  indeterminate?: boolean;
  /** Secondary line, linked with aria-describedby. */
  description?: ReactNode;
  /** Goes on the outermost rendered element, like every kit control: here the <label>. */
  className?: string;
} & ({ label: VisibleLabel } | { label?: undefined; "aria-label": string });

/**
 * Native checkbox or radio inside its <label>, so the text toggles it. A
 * table-row checkbox has no visible label and must pass aria-label
 * ('Select {name}'); the type enforces one or the other.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { type = "checkbox", indeterminate = false, description, label, className, disabled, ...rest },
  ref,
) {
  const inner = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => inner.current as HTMLInputElement);
  const descId = useId();
  const unnamed = (label === undefined || label === "") && !rest["aria-label"] && !rest["aria-labelledby"];

  useEffect(() => {
    if (inner.current) inner.current.indeterminate = type === "checkbox" && indeterminate;
  }, [indeterminate, type]);

  useEffect(() => {
    if (import.meta.env.DEV && unnamed) {
      console.warn("[ui] Checkbox needs a visible label or aria-label.");
    }
  }, [unnamed]);

  return (
    <label
      className={cx(
        "ui-check",
        description !== undefined && "ui-check--described",
        disabled && "ui-check--disabled",
        className,
      )}
    >
      <input
        {...rest}
        ref={inner}
        type={type}
        disabled={disabled}
        className="ui-check__input"
        aria-describedby={description !== undefined ? descId : rest["aria-describedby"]}
      />
      {(label !== undefined || description !== undefined) && (
        <span className="ui-check__text">
          {label !== undefined && <span className="ui-check__label">{label}</span>}
          {description !== undefined && (
            <span className="ui-check__desc" id={descId}>
              {description}
            </span>
          )}
        </span>
      )}
    </label>
  );
});
