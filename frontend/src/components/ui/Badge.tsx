import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import "./Badge.css";

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

export interface BadgeProps {
  /** Default 'neutral'. Status tones never encode rarity or categories. */
  tone?: BadgeTone;
  /** 12px; required whenever the tone carries status meaning. */
  icon?: LucideIcon;
  /** 8px currentColor dot when no icon fits. */
  dot?: boolean;
  children: ReactNode;
  className?: string;
}

/** Small tone-coded label with visible text. Numeric counts use .ui-count. */
export function Badge({ tone = "neutral", icon: Icon, dot = false, children, className }: BadgeProps) {
  return (
    <span className={className ? `ui-badge ui-badge--${tone} ${className}` : `ui-badge ui-badge--${tone}`}>
      {Icon ? <Icon className="ui-badge__icon" aria-hidden="true" /> : dot ? <span className="ui-badge__dot" aria-hidden="true" /> : null}
      <span className="ui-badge__text">{children}</span>
    </span>
  );
}
