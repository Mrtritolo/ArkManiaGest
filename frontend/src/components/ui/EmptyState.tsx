import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import "./EmptyState.css";

export interface EmptyStateProps {
  icon?: LucideIcon;
  /** Names what is missing: 'No bans yet', 'No matches'. */
  title: string;
  /** Max 38ch: where items come from, or how to change the filters. */
  description?: ReactNode;
  /** At most one Button (secondary): 'Clear filters', 'Scan now'. */
  action?: ReactNode;
}

/**
 * Empty collection or filter with no matches. Render it only after loading
 * finished without error (loading = Spinner, failure = Alert).
 */
export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="ui-empty">
      {Icon && (
        <span className="ui-empty__icon" aria-hidden="true">
          <Icon />
        </span>
      )}
      <p className="ui-empty__title">{title}</p>
      {description !== undefined && <div className="ui-empty__description">{description}</div>}
      {action !== undefined && <div className="ui-empty__action">{action}</div>}
    </div>
  );
}
