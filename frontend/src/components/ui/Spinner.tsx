import { LoaderCircle } from "lucide-react";
import { cx } from "./cx";
import "./Spinner.css";

export interface SpinnerProps {
  /** Visible text; adds role="status" so the phrase is announced. */
  label?: string;
  /** Centred block with padding, for the first load of a card, table or page. */
  block?: boolean;
}

/**
 * Loading indicator. Without a label the icon is decorative and the owning
 * control or region carries aria-busy. Refetches keep stale content visible
 * with an inline Spinner instead of swapping in a block.
 */
export function Spinner({ label, block = false }: SpinnerProps) {
  return (
    <span className={cx("ui-spinner", block && "ui-spinner--block")} role={label ? "status" : undefined}>
      <LoaderCircle className="ui-spinner__icon" aria-hidden="true" />
      {label && <span>{label}</span>}
    </span>
  );
}
