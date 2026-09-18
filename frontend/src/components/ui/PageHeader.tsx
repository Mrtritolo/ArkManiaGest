import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import "./PageHeader.css";

export interface PageHeaderProps {
  title: string;
  icon?: LucideIcon;
  /** Subtitle; counts and 'updated at' go here as text. */
  description?: ReactNode;
  /** Wraps under the title below 600px (buttons go full width). */
  actions?: ReactNode;
}

/** The page's only <h1>, with description and a wrapping action cluster. */
export function PageHeader({ title, icon: Icon, description, actions }: PageHeaderProps) {
  return (
    <header className="ui-page-header">
      <div className="ui-page-header__text">
        <h1 className="ui-page-header__title">
          {Icon && <Icon className="ui-page-header__icon" aria-hidden="true" />}
          <span>{title}</span>
        </h1>
        {description !== undefined && <div className="ui-page-header__description">{description}</div>}
      </div>
      {actions !== undefined && <div className="ui-page-header__actions">{actions}</div>}
    </header>
  );
}
