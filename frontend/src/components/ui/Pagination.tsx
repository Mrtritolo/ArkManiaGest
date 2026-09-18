import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "./Button";
import "./Pagination.css";

export interface PaginationProps {
  /** 0-based. */
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  /** nav aria-label, e.g. t('auditLog.pagination'). */
  label: string;
}

/**
 * Previous / next for server-paginated lists. The "Page x of y" text is a
 * polite status, so a page change (and reaching the last page, where the
 * focused Next turns aria-disabled) is announced.
 */
export function Pagination({ page, pageCount, onPageChange, label }: PaginationProps) {
  const { t } = useTranslation();
  const total = Math.max(1, pageCount);
  const atStart = page <= 0;
  const atEnd = page >= total - 1;

  return (
    <nav className="ui-pagination" aria-label={label}>
      <Button size="sm" icon={ChevronLeft} disabled={atStart} onClick={() => onPageChange(page - 1)}>
        {t("ui.pagination.previous")}
      </Button>
      <span className="ui-pagination__status" role="status">
        {t("ui.pagination.pageOf", { page: Math.min(page + 1, total), total })}
      </span>
      <Button size="sm" disabled={atEnd} onClick={() => onPageChange(page + 1)}>
        {t("ui.pagination.next")}
        <ChevronRight aria-hidden="true" />
      </Button>
    </nav>
  );
}
