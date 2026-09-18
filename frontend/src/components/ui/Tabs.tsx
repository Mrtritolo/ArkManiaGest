import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import "./Tabs.css";

export interface TabItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  /** Rendered as a visible .ui-count chip. */
  count?: number;
}

export interface TabsProps {
  /** aria-label of the tablist. */
  label: string;
  items: readonly TabItem[];
  value: string;
  /**
   * Deep links: pass value/onChange from useSearchParams. The parent may
   * refuse or defer a switch (e.g. useConfirm on a dirty form): keyboard
   * focus follows `value`, not the key press.
   */
  onChange: (id: string) => void;
  /** Content of the active tab only; state that must survive a switch stays in the page. */
  children: ReactNode;
  /**
   * Make the tabpanel itself a tab stop. Only for panels with no focusable
   * content (plain text, a read-only list): WAI-ARIA APG.
   */
  focusablePanel?: boolean;
  className?: string;
}

/**
 * Tablist + one tabpanel. Roving tabindex; ArrowLeft/ArrowRight/Home/End move
 * from the focused tab and activate (automatic activation).
 */
export function Tabs({ label, items, value, onChange, children, focusablePanel = false, className }: TabsProps) {
  const baseId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // The tab a key press asked for. It is focused only once `value` becomes it,
  // so a refused switch leaves focus on the tab that is still selected.
  const keyboardTarget = useRef<string | null>(null);
  const selectedIndex = Math.max(0, items.findIndex(item => item.id === value));
  const tabId = (index: number) => `${baseId}-tab-${index}`;
  const panelId = `${baseId}-panel`;

  useEffect(() => {
    const target = keyboardTarget.current;
    keyboardTarget.current = null;
    if (target !== value) return;
    // Never pull focus from elsewhere (a deferred switch may land later).
    const active = document.activeElement;
    if (active && active !== document.body && !listRef.current?.contains(active)) return;
    tabRefs.current[items.findIndex(item => item.id === value)]?.focus();
    // Runs when the selection changes; items are read from the same render.
  }, [value]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = tabRefs.current.findIndex(tab => tab === event.target);
    if (current === -1) return;
    const last = items.length - 1;
    let next: number | null = null;
    if (event.key === "ArrowRight") next = current >= last ? 0 : current + 1;
    else if (event.key === "ArrowLeft") next = current <= 0 ? last : current - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    const item = next === null ? undefined : items[next];
    if (next === null || !item) return;
    event.preventDefault();
    if (item.id === value) {
      // Focus sat on an unselected tab (a refused click): just move it home.
      keyboardTarget.current = null;
      tabRefs.current[next]?.focus();
      return;
    }
    keyboardTarget.current = item.id;
    onChange(item.id);
  }

  return (
    <div className={className ? `ui-tabs ${className}` : "ui-tabs"}>
      <div ref={listRef} className="ui-tabs__list" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
        {items.map((item, index) => {
          const selected = index === selectedIndex;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              ref={el => {
                tabRefs.current[index] = el;
              }}
              type="button"
              role="tab"
              id={tabId(index)}
              className="ui-tabs__tab"
              aria-selected={selected}
              aria-controls={selected ? panelId : undefined}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(item.id)}
            >
              {Icon && <Icon aria-hidden="true" />}
              {/* The hidden bold copy reserves the selected width: no jump on switch. */}
              <span className="ui-bold-stable">
                <span>{item.label}</span>
                <span className="ui-bold-stable__reserve" aria-hidden="true">
                  {item.label}
                </span>
              </span>
              {item.count !== undefined && <span className="ui-count">{item.count}</span>}
            </button>
          );
        })}
      </div>
      <div
        className="ui-tabs__panel"
        role="tabpanel"
        id={panelId}
        aria-labelledby={tabId(selectedIndex)}
        tabIndex={focusablePanel ? 0 : undefined}
      >
        {children}
      </div>
    </div>
  );
}
