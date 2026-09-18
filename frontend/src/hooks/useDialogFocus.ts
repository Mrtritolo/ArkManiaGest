/**
 * useDialogFocus -- everything a modal surface needs, built ON TOP of
 * hooks/useModalA11y (reused as-is, never copied).
 *
 * useModalA11y already gives the panel role="dialog", aria-modal, Escape,
 * the first focus move and focus restore. This hook adds what it lacks:
 *
 *   - a module-level stack, so Escape closes only the top-most dialog;
 *   - `dismissible: false` (busy dialogs ignore Escape);
 *   - everything outside the dialog becomes `inert` (the toast region, marked
 *     with data-ui-toast-region, stays interactive), so assistive technology
 *     and the pointer cannot reach the page behind. Inert is counted per
 *     element, so stacked dialogs that share a background (#root) never
 *     lift it while another dialog is still open;
 *   - page scroll lock (html.ui-scroll-locked, see styles/base.css);
 *   - initial focus: `initialFocusRef`, else the first form control that is
 *     a Tab stop, else the panel (useModalA11y's default);
 *   - a Tab cycle that knows radio groups: a group (SegmentedControl, radio
 *     Checkboxes) is ONE stop, its checked radio. useModalA11y's cycle counts
 *     every radio, so focus escaped when a group with a later radio checked
 *     came last (or first). This listener runs before it and wraps at the
 *     real first and last stops; by the time useModalA11y's listener runs,
 *     focus has already moved, so its own check does nothing. Propagation is
 *     never stopped: widgets inside still see Tab (Combobox closes its list);
 *   - focus falls back to #main-content when the trigger no longer exists
 *     (e.g. the row that opened a delete dialog was removed);
 *   - role and aria-modal only while open, so an element that stays rendered
 *     when closed is never exposed as a permanent modal dialog.
 *
 * Ordering matters and is why this is one hook: React runs effects, and
 * their cleanups, in declaration order. Effect (1) registers its Tab listener
 * BEFORE useModalA11y registers its own on the same node (so it runs first),
 * and its cleanup lifts `inert` BEFORE useModalA11y's cleanup
 * restores focus (an inert trigger cannot take focus). Effect (2) runs AFTER
 * useModalA11y has recorded the trigger and focused the panel, so it can move
 * focus to the initial target and, on cleanup, check where the restore landed.
 *
 * Escape inside a nested widget (an open Combobox list) is handled by that
 * widget on `window` in the capture phase, which runs before useModalA11y's
 * `document` listener, so closing the list never closes the dialog.
 *
 * Consumers: components/ui/Modal (and so ConfirmDialog), and the shell's
 * mobile navigation drawer. The drawer is a dialog WRAPPING the navigation,
 * rendered only while open; the <nav> keeps its landmark role:
 *
 *     const rootRef = useRef<HTMLDivElement>(null)
 *     const { panelProps } = useDialogFocus(open, { onClose, rootRef })
 *     {open && (
 *       <div ref={rootRef}>
 *         <div className="scrim" onClick={onClose} />
 *         <div {...panelProps} aria-label={t('nav.menu')}>
 *           <nav aria-label={t('nav.main')}>…</nav>
 *         </div>
 *       </div>
 *     )}
 *
 * The desktop sidebar (900px and up) is never given panelProps.
 *
 * `rootRef` is the outermost element of the dialog (overlay, or drawer plus
 * scrim); it defaults to the panel. Every sibling of it and of its ancestors
 * becomes inert while the dialog is open.
 */
import { useEffect, useRef, type RefObject } from "react";
import { useModalA11y } from "./useModalA11y";

export interface DialogFocusOptions {
  onClose: () => void;
  /** Default true. False while busy: Escape is ignored (callers also disable their own close controls). */
  dismissible?: boolean;
  /** Receives focus on open instead of the first form control. */
  initialFocusRef?: RefObject<HTMLElement>;
  /** Outermost element of the dialog; defaults to the panel. */
  rootRef?: RefObject<HTMLElement>;
}

/** Spread on the dialog panel. role and aria-modal are present only while open. */
export interface DialogPanelProps {
  ref: RefObject<HTMLDivElement>;
  role?: "dialog";
  "aria-modal"?: true;
  tabIndex: -1;
}

/** Open dialogs, top-most last. */
const stack: symbol[] = [];
let scrollLocks = 0;
/** How many open dialogs hold each element inert. */
const inertHolds = new Map<HTMLElement, number>();

const FORM_CONTROLS = [
  'input:not([type="hidden"]):not([disabled])',
  "select:not([disabled])",
  "textarea:not([disabled])",
].join(",");

/** Candidates for a Tab stop; filtered by tabIndex and rendering below. */
const TABBABLE = [
  "a[href]",
  "button:not([disabled])",
  'input:not([type="hidden"]):not([disabled])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "[tabindex]",
].join(",");

/** Make every sibling of `root` and of each of its ancestors inert; return what this dialog now holds. */
function inertOutside(root: HTMLElement): HTMLElement[] {
  const held: HTMLElement[] = [];
  let node: HTMLElement = root;
  while (node !== document.body && node.parentElement) {
    for (const sibling of Array.from(node.parentElement.children)) {
      if (sibling === node || !(sibling instanceof HTMLElement)) continue;
      if (sibling.hasAttribute("data-ui-toast-region")) continue;
      if (sibling.tagName === "SCRIPT" || sibling.tagName === "STYLE") continue;
      const holds = inertHolds.get(sibling) ?? 0;
      // Inert for another reason (not a kit dialog): not ours to lift later.
      if (holds === 0 && sibling.inert) continue;
      inertHolds.set(sibling, holds + 1);
      sibling.inert = true;
      held.push(sibling);
    }
    node = node.parentElement;
  }
  return held;
}

function releaseInert(elements: readonly HTMLElement[]) {
  for (const element of elements) {
    const holds = (inertHolds.get(element) ?? 1) - 1;
    if (holds > 0) {
      inertHolds.set(element, holds);
    } else {
      inertHolds.delete(element);
      element.inert = false;
    }
  }
}

/** The panel's Tab stops in order, with each named radio group reduced to one stop. */
function tabStops(panel: HTMLElement): HTMLElement[] {
  const candidates = Array.from(panel.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    // offsetParent null = not rendered (a collapsed section, [hidden]).
    el => el.tabIndex >= 0 && el.offsetParent !== null,
  );
  return candidates.filter(el => {
    if (!(el instanceof HTMLInputElement) || el.type !== "radio" || el.name === "") return true;
    const group = candidates.filter(
      (other): other is HTMLInputElement =>
        other instanceof HTMLInputElement && other.type === "radio" && other.name === el.name && other.form === el.form,
    );
    return el === (group.find(radio => radio.checked) ?? group[0]);
  });
}

export function useDialogFocus(open: boolean, options: DialogFocusOptions): { panelProps: DialogPanelProps } {
  const { onClose, dismissible = true, initialFocusRef, rootRef } = options;
  const token = useRef<symbol | null>(null);
  const madeInert = useRef<HTMLElement[]>([]);
  const panelElement = useRef<HTMLDivElement | null>(null);
  const latest = useRef({ onClose, dismissible });
  latest.current = { onClose, dismissible };

  // (1) Stack, scroll lock and the Tab cycle. Its cleanup lifts inert first (see header).
  useEffect(() => {
    if (!open) return;
    const id = Symbol("dialog");
    token.current = id;
    stack.push(id);
    if (scrollLocks++ === 0) document.documentElement.classList.add("ui-scroll-locked");

    function onTab(event: KeyboardEvent) {
      if (event.key !== "Tab" || stack[stack.length - 1] !== id) return;
      const panel = panelElement.current;
      if (!panel) return;
      const stops = tabStops(panel);
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      const active = document.activeElement;
      const outside = !panel.contains(active);
      if (event.shiftKey && (active === first || active === panel || outside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || outside)) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onTab, true);

    return () => {
      document.removeEventListener("keydown", onTab, true);
      releaseInert(madeInert.current);
      madeInert.current = [];
      const at = stack.indexOf(id);
      if (at !== -1) stack.splice(at, 1);
      if (--scrollLocks === 0) document.documentElement.classList.remove("ui-scroll-locked");
    };
  }, [open]);

  const { panelProps: a11y } = useModalA11y(open, () => {
    const { onClose: close, dismissible: canDismiss } = latest.current;
    if (canDismiss && stack[stack.length - 1] === token.current) close();
  });

  // (2) Inert outside + initial focus; cleanup falls back to #main-content.
  useEffect(() => {
    if (!open) return;
    const panel = a11y.ref.current;
    panelElement.current = panel;
    const root = rootRef?.current ?? panel;
    if (root) madeInert.current = inertOutside(root);
    const firstControl = panel ? tabStops(panel).find(el => el.matches(FORM_CONTROLS)) : undefined;
    (initialFocusRef?.current ?? firstControl)?.focus();
    return () => {
      const active = document.activeElement;
      if (!active || active === document.body) {
        document.getElementById("main-content")?.focus();
      }
    };
    // Refs are read once, when the dialog opens, by design.
  }, [open]);

  const panelProps: DialogPanelProps = open ? a11y : { ref: a11y.ref, tabIndex: a11y.tabIndex };
  return { panelProps };
}
