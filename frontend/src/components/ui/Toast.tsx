import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { CircleAlert, CircleCheck, Info, X, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import "./Toast.css";

export interface ToastOptions {
  title?: string;
  /**
   * One action (Retry, Undo, Open logs). Clicking it also dismisses the
   * toast. A toast with an action never auto-dismisses, whatever its tone,
   * so keyboard and screen-reader users have time to reach it.
   */
  action?: { label: string; onClick: () => void };
}

export interface ToastApi {
  /** Auto-dismiss after 5s, paused while hovered or focused (persistent with an action). */
  success(message: string, options?: ToastOptions): string;
  /** Auto-dismiss after 5s, paused while hovered or focused (persistent with an action). */
  info(message: string, options?: ToastOptions): string;
  /** Persists until dismissed. */
  error(message: string, options?: ToastOptions): string;
  dismiss(id: string): void;
}

type Tone = "success" | "info" | "error";

interface ToastItem extends ToastOptions {
  id: string;
  /** Arrival order. */
  seq: number;
  tone: Tone;
  message: string;
  /** Rendered in the region; false = waiting for a free slot. */
  shown: boolean;
}

const AUTO_DISMISS_MS = 5000;
const MAX_VISIBLE = 3;

const ICONS: Record<Tone, LucideIcon> = { success: CircleCheck, info: Info, error: CircleAlert };

const isPersistent = (item: ToastItem) => item.tone === "error" || item.action !== undefined;

/**
 * Fill the region (at most MAX_VISIBLE) with waiting toasts, oldest first.
 * When it is full, a waiting toast may take the slot of an OLDER toast that
 * is neither hovered nor focused: an auto-dismissing one that has already
 * rendered is removed; otherwise the oldest persistent one goes back to
 * waiting and reappears when a slot frees. With nothing to displace it waits.
 * Nothing is ever dropped unseen, and a toast the user is on never moves.
 */
function schedule(list: ToastItem[], held: ReadonlySet<string>, rendered: ReadonlySet<string>): ToastItem[] {
  let next = list;
  for (const item of list) {
    if (item.shown) continue;
    const shown = next.filter(other => other.shown);
    if (shown.length >= MAX_VISIBLE) {
      const older = shown.filter(other => other.seq < item.seq && !held.has(other.id));
      const victim =
        older.find(other => !isPersistent(other) && rendered.has(other.id)) ?? older.find(isPersistent);
      if (!victim) continue;
      next = isPersistent(victim)
        ? next.map(other => (other.id === victim.id ? { ...other, shown: false } : other))
        : next.filter(other => other.id !== victim.id);
    }
    next = next.map(other => (other.id === item.id ? { ...other, shown: true } : other));
  }
  return next;
}

interface ToastHandlers {
  onDismiss: (id: string) => void;
  /** The toast is hovered or holds focus. */
  onHold: (id: string, held: boolean) => void;
  onRendered: (id: string, rendered: boolean) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Mount once, inside <BrowserRouter> in App.tsx, with ConfirmProvider inside
 * it. Rule of thumb: page-load failures use Alert, action failures use
 * toast.error, field validation uses Field.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextSeq = useRef(1);
  const regionRef = useRef<HTMLElement>(null);
  const held = useRef(new Set<string>());
  const rendered = useRef(new Set<string>());

  // Hovered or focused toasts. Focus is also read from the DOM, so a toast
  // that holds focus is protected even when no focus event reached it.
  const holding = useCallback((): ReadonlySet<string> => {
    const active = document.activeElement;
    const id = active?.closest("[data-ui-toast-id]")?.getAttribute("data-ui-toast-id");
    return id ? new Set([...held.current, id]) : new Set(held.current);
  }, []);

  const dismiss = useCallback((id: string) => {
    // Focus inside a toast that is being removed would fall back to <body>:
    // send it to the main landmark instead (unless an action moved it already).
    const element = regionRef.current?.querySelector(`[data-ui-toast-id="${id}"]`);
    if (element?.contains(document.activeElement)) {
      document.getElementById("main-content")?.focus({ preventScroll: true });
    }
    held.current.delete(id);
    const holds = holding();
    setItems(list => schedule(list.filter(item => item.id !== id), holds, rendered.current));
  }, [holding]);

  const push = useCallback((tone: Tone, message: string, options?: ToastOptions) => {
    const seq = nextSeq.current++;
    const id = `toast-${seq}`;
    const holds = holding();
    setItems(list => schedule([...list, { ...options, id, seq, tone, message, shown: false }], holds, rendered.current));
    return id;
  }, [holding]);

  const handlers = useMemo<ToastHandlers>(
    () => ({
      onDismiss: dismiss,
      onHold: (id, isHeld) => {
        if (isHeld) held.current.add(id);
        else held.current.delete(id);
      },
      onRendered: (id, isRendered) => {
        if (isRendered) rendered.current.add(id);
        else rendered.current.delete(id);
      },
    }),
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (message, options) => push("success", message, options),
      info: (message, options) => push("info", message, options),
      error: (message, options) => push("error", message, options),
      dismiss,
    }),
    [push, dismiss],
  );

  const visible = items.filter(item => item.shown);
  const polite = visible.filter(item => item.tone !== "error");
  const assertive = visible.filter(item => item.tone === "error");

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        // Kept interactive while a dialog makes the page inert (useDialogFocus).
        <section
          ref={regionRef}
          className="ui-toast-region"
          aria-label={t("ui.notifications")}
          data-ui-toast-region=""
        >
          {/* Both live regions exist from the first render, so insertions are announced. */}
          <div className="ui-toast-region__list" role="status" aria-atomic="false">
            {polite.map(item => (
              <Toast key={item.id} item={item} handlers={handlers} />
            ))}
          </div>
          <div className="ui-toast-region__list" role="alert" aria-atomic="false">
            {assertive.map(item => (
              <Toast key={item.id} item={item} handlers={handlers} />
            ))}
          </div>
        </section>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast must be used inside <ToastProvider>.");
  return api;
}

function Toast({ item, handlers }: { item: ToastItem; handlers: ToastHandlers }) {
  const { t } = useTranslation();
  const { onDismiss, onHold, onRendered } = handlers;
  const [paused, setPaused] = useState(false);
  const hovered = useRef(false);
  const focused = useRef(false);
  const remaining = useRef(AUTO_DISMISS_MS);
  const Icon = ICONS[item.tone];
  const transient = !isPersistent(item);

  useEffect(() => {
    onRendered(item.id, true);
    return () => {
      onRendered(item.id, false);
      onHold(item.id, false);
    };
  }, [item.id, onRendered, onHold]);

  // Countdown that pauses while hovered or focused and resumes afterwards.
  useEffect(() => {
    if (!transient || paused) return;
    const startedAt = Date.now();
    const timer = window.setTimeout(() => onDismiss(item.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt));
    };
  }, [transient, paused, item.id, onDismiss]);

  const sync = () => {
    const isHeld = hovered.current || focused.current;
    onHold(item.id, isHeld);
    setPaused(isHeld);
  };

  return (
    <div
      className={`ui-toast ui-toast--${item.tone}`}
      data-ui-toast-id={item.id}
      onMouseEnter={() => {
        hovered.current = true;
        sync();
      }}
      onMouseLeave={() => {
        hovered.current = false;
        sync();
      }}
      onFocus={() => {
        focused.current = true;
        sync();
      }}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          focused.current = false;
          sync();
        }
      }}
    >
      <Icon className="ui-toast__icon" aria-hidden="true" />
      <div className="ui-toast__content">
        {item.title && <p className="ui-toast__title">{item.title}</p>}
        <p className="ui-toast__message">{item.message}</p>
        {item.action && (
          <div className="ui-toast__action">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                item.action?.onClick();
                onDismiss(item.id);
              }}
            >
              {item.action.label}
            </Button>
          </div>
        )}
      </div>
      <IconButton size="sm" icon={X} label={t("ui.dismissNotification")} onClick={() => onDismiss(item.id)} />
    </div>
  );
}
