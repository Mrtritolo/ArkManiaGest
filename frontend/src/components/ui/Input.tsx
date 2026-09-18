import { forwardRef, useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cx } from "./cx";
import { useFieldControl } from "./Field";
import { IconButton } from "./IconButton";
import "./Field.css";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** sm 28px for in-table editing, md 32px (40px in the player scope). */
  size?: "sm" | "md";
  /** JetBrains Mono + tabular figures, ligatures off: IDs, numbers, paths, tokens. */
  mono?: boolean;
  /**
   * type="password" only: trailing toggle that shows the value (aria-pressed;
   * the eye icon turns into eye-off). It stays usable while the input is
   * `disabled` or `readOnly`: reading a value the backend already sent is not
   * editing it.
   */
  revealable?: boolean;
  /**
   * Goes on the outermost rendered element, like every kit control: the
   * <input> itself, or the wrapper <span> when one is rendered
   * (type="search", or a revealable password).
   */
  className?: string;
}

/**
 * Themed input. type="search" adds the leading search icon. Inside a Field it
 * is labelled automatically; outside one it needs aria-label.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { size = "md", mono = false, revealable = false, type = "text", className, ...rest },
  ref,
) {
  const { t } = useTranslation();
  const a11y = useFieldControl(rest, "Input");
  const [revealed, setRevealed] = useState(false);
  const isSearch = type === "search";
  const canReveal = revealable && type === "password";

  const input = (
    <input
      {...rest}
      {...a11y}
      ref={ref}
      type={canReveal && revealed ? "text" : type}
      className={cx(
        "ui-control",
        size === "sm" && "ui-control--sm",
        mono && "ui-control--mono",
        !isSearch && !canReveal && className,
      )}
    />
  );

  if (!isSearch && !canReveal) return input;

  return (
    <span
      className={cx(
        "ui-input-wrap",
        isSearch && "ui-input-wrap--lead",
        canReveal && "ui-input-wrap--trail",
        className,
      )}
    >
      {isSearch && <Search className="ui-input-wrap__lead" aria-hidden="true" />}
      {input}
      {canReveal && (
        <span className="ui-input-wrap__trail">
          <IconButton
            size="sm"
            icon={revealed ? EyeOff : Eye}
            label={t("ui.showPassword")}
            pressed={revealed}
            onClick={() => setRevealed(v => !v)}
          />
        </span>
      )}
    </span>
  );
});
