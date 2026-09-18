import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cx } from "./cx";
import { useFieldControl } from "./Field";
import "./Field.css";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Editors (JSON, INI, SQL): mono 13px/1.6, ligatures off, tab-size 2, no wrapping. */
  mono?: boolean;
  /** Goes on the outermost rendered element, like every kit control: here the <textarea>. */
  className?: string;
}

/**
 * Multi-line input. A character counter goes in the Field hint, so it lands
 * in aria-describedby. An editor that traps Tab must release it on Escape.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { mono = false, className, ...rest },
  ref,
) {
  const a11y = useFieldControl(rest, "Textarea");
  return (
    <textarea
      {...rest}
      {...a11y}
      ref={ref}
      spellCheck={mono ? false : rest.spellCheck}
      className={cx("ui-control", mono && "ui-control--mono", className)}
    />
  );
});
