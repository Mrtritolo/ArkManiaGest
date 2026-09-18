import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cx } from "./cx";
import "./Table.css";

export interface TableProps {
  /** Accessible name of the scroll region, repeated as a visually hidden <caption>. */
  label: string;
  /** px. Below it only the table scrolls horizontally, never the page. */
  minWidth?: number;
  /** e.g. '60vh'. Enables vertical scrolling AND a sticky <thead>, and only then. */
  maxHeight?: string;
  /** <thead> + <tbody>, written by the page. */
  children: ReactNode;
  className?: string;
}

/**
 * A real <table> in a labelled region. Class contract (Table.css): rows are
 * 36px (44px with .ui-cell-2); put row IconButtons in .ui-row-actions;
 * selection is tr[data-selected] + a Checkbox; clickable rows keep a real
 * <button class="ui-row-button"> or <Link> in the primary cell; quantities use
 * "u-num u-text-end".
 *
 * The region is a tab stop only while it actually overflows (so keyboard
 * users can scroll it); a table that fits adds no extra stop.
 */
export function Table({ label, minWidth, maxHeight, children, className }: TableProps) {
  const regionRef = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);

  useEffect(() => {
    const region = regionRef.current;
    if (!region) return;
    const check = () =>
      setScrollable(region.scrollWidth > region.clientWidth || region.scrollHeight > region.clientHeight);
    check();
    // The region resizes with the viewport, the table with its rows.
    const observer = new ResizeObserver(check);
    observer.observe(region);
    if (region.firstElementChild) observer.observe(region.firstElementChild);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={regionRef}
      className={cx("ui-table-scroll", maxHeight !== undefined && "ui-table-scroll--capped", className)}
      role="region"
      aria-label={label}
      tabIndex={scrollable ? 0 : undefined}
      style={maxHeight !== undefined ? { maxHeight } : undefined}
    >
      <table className="ui-table" style={minWidth !== undefined ? { minWidth } : undefined}>
        <caption className="u-sr-only">{label}</caption>
        {children}
      </table>
    </div>
  );
}

export interface TableMessageRowProps {
  colSpan: number;
  /** <Spinner block label/> | <EmptyState/> | <Alert tone="danger"/> */
  children: ReactNode;
}

/** Full-width state row for loading, empty and error inside <tbody>. */
export function TableMessageRow({ colSpan, children }: TableMessageRowProps) {
  return (
    <tr className="ui-table__message">
      <td colSpan={colSpan}>{children}</td>
    </tr>
  );
}

/** Empty cell value: a visual '--' with a spoken 'Not available'. */
export function NotAvailable() {
  const { t } = useTranslation();
  return (
    <>
      <span className="ui-na" aria-hidden="true">
        --
      </span>
      <span className="u-sr-only">{t("ui.notAvailable")}</span>
    </>
  );
}
