/**
 * useModalA11y — makes a modal window usable from the keyboard.
 *
 * The panel had fourteen hand-built overlays made of `<div>`s with
 * `position: fixed`, and none of them was a dialog as far as the browser
 * knew: no `role`, no `aria-modal`, no focus trap, no Escape to close
 * (handled exactly once in the whole app, in a popover). Keyboard users
 * opened the modal and kept tabbing through the page underneath, with no
 * way to close it.
 *
 * The hook covers the four missing pieces:
 *   - `role="dialog"` + `aria-modal` on the panel, so assistive technology
 *     announces a window rather than an arbitrary box;
 *   - Escape closes;
 *   - Tab and Shift+Tab cycle INSIDE the panel;
 *   - on close, focus returns to where it was, not to the top of the document.
 *
 * Usage:
 *
 *     const { panelProps } = useModalA11y(isOpen, close)
 *     ...
 *     <div className="overlay" onClick={close}>
 *       <div {...panelProps} onClick={e => e.stopPropagation()}>…</div>
 *     </div>
 *
 * The panel must be labelled: `aria-labelledby` pointing at the title's id,
 * or `aria-label` when there is no visible title.
 */
import { useEffect, useRef } from "react";

/** What the browser considers reachable with Tab. */
const FOCUSABLE = [
  "a[href]", "button:not([disabled])", "input:not([disabled])",
  "select:not([disabled])", "textarea:not([disabled])", "summary",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export interface ModalA11y {
  panelProps: {
    ref: React.RefObject<HTMLDivElement>;
    role: "dialog";
    "aria-modal": true;
    tabIndex: -1;
  };
}

export function useModalA11y(open: boolean, onClose: () => void): ModalA11y {
  const panelRef = useRef<HTMLDivElement>(null);

  // onClose changes identity on every render of the caller. Keeping it in a
  // ref stops the effect from re-running and stealing focus while typing.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Move focus into the panel: without this the first Tab starts again
    // from the top of the document, i.e. from behind the overlay.
    panelRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
        // offsetParent null = element not rendered: a control inside a
        // collapsed section must not join the cycle.
        .filter(el => el.offsetParent !== null);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    // Capture phase: an input inside the modal that stops key propagation
    // must not be able to disable Escape.
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previouslyFocused?.focus?.();
    };
  }, [open]);

  return {
    panelProps: {
      ref: panelRef,
      role: "dialog",
      "aria-modal": true,
      tabIndex: -1,
    },
  };
}
