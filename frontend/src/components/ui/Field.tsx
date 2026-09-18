import { createContext, useContext, useEffect, useId, type ReactElement, type ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { cx } from "./cx";
import "./Field.css";

interface FieldContextValue {
  id: string;
  labelId: string;
  describedBy?: string;
  invalid: boolean;
  required: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

export interface FieldProps {
  label: ReactNode;
  /** Exactly one Input | Select | Textarea | Combobox. */
  children: ReactElement;
  hint?: ReactNode;
  /** Cause + fix ('Enter a port between 1 and 65535'). Sets aria-invalid on the control. */
  error?: string | null;
  /** aria-required on the control; the visible asterisk is decorative. */
  required?: boolean;
  /** Grid placement only, e.g. 'u-span-full'. */
  className?: string;
}

/**
 * Label + one control + hint + error, wired with ids. The error is not a
 * live region: validation runs on blur, and after a failed submit the page
 * focuses the first invalid control.
 */
export function Field({ label, children, hint, error, required = false, className }: FieldProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cx("ui-field", className)}>
      <label className="ui-field__label" htmlFor={id} id={labelId}>
        {label}
        {required && (
          <span className="ui-field__required" aria-hidden="true">
            *
          </span>
        )}
      </label>
      <FieldContext.Provider value={{ id, labelId, describedBy, invalid: Boolean(error), required }}>
        {children}
      </FieldContext.Provider>
      {error && (
        <p className="ui-field__error" id={errorId}>
          <CircleAlert aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
      {hint && (
        <p className="ui-field__hint" id={hintId}>
          {hint}
        </p>
      )}
    </div>
  );
}

interface ControlA11yProps {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false" | "grammar" | "spelling";
  "aria-required"?: boolean | "true" | "false";
  "aria-label"?: string;
  "aria-labelledby"?: string;
}

/**
 * Internal: merge the enclosing Field's wiring into a control's props, and
 * warn in development when a control has no accessible name at all.
 */
export function useFieldControl(props: ControlA11yProps, componentName: string) {
  const field = useContext(FieldContext);
  const unnamed = !field && !props["aria-label"] && !props["aria-labelledby"];

  useEffect(() => {
    if (import.meta.env.DEV && unnamed) {
      console.warn(`[ui] ${componentName} outside a <Field> needs aria-label or aria-labelledby.`);
    }
  }, [unnamed, componentName]);

  const describedBy = [field?.describedBy, props["aria-describedby"]].filter(Boolean).join(" ") || undefined;
  const invalid = field?.invalid || props["aria-invalid"] === true || props["aria-invalid"] === "true";

  return {
    id: field?.id ?? props.id,
    "aria-describedby": describedBy,
    "aria-invalid": invalid || undefined,
    "aria-required": field?.required || props["aria-required"] || undefined,
  };
}

/** Internal: id of the enclosing Field's <label>, to name a related popup (Combobox listbox). */
export function useFieldLabelId(): string | undefined {
  return useContext(FieldContext)?.labelId;
}
