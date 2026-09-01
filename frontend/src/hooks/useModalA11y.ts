/**
 * useModalA11y — rende una finestra modale usabile da tastiera.
 *
 * Il pannello aveva quattordici overlay costruiti a mano come `<div>` con
 * `position: fixed`, e nessuno di essi era una finestra di dialogo per il
 * browser: niente `role`, niente `aria-modal`, nessuna cattura del focus,
 * nessuna chiusura con Escape (gestita una volta sola in tutta l'app, in un
 * popover). Chi naviga da tastiera apriva la modale e continuava a tabulare
 * nella pagina sotto, senza modo di chiuderla.
 *
 * L'hook copre le quattro cose che mancavano:
 *   - `role="dialog"` + `aria-modal` sul pannello, cosi' le tecnologie
 *     assistive annunciano una finestra e non un riquadro qualunque;
 *   - Escape chiude;
 *   - Tab e Shift+Tab ciclano DENTRO il pannello;
 *   - alla chiusura il focus torna dov'era, non all'inizio del documento.
 *
 * Uso:
 *
 *     const { panelProps } = useModalA11y(isOpen, close)
 *     ...
 *     <div className="overlay" onClick={close}>
 *       <div {...panelProps} onClick={e => e.stopPropagation()}>…</div>
 *     </div>
 *
 * Il pannello va etichettato: `aria-labelledby` sull'id del titolo, oppure
 * `aria-label` quando un titolo visibile non c'e'.
 */
import { useEffect, useRef } from "react";

/** Cio' che il browser considera raggiungibile con Tab. */
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

  // onClose cambia identita' a ogni render del chiamante. Tenerlo in un ref
  // evita che l'effetto si ri-esegua e rubi il focus mentre si digita.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Il focus entra nel pannello: senza questo il primo Tab riparte
    // dall'inizio del documento, cioe' da dietro l'overlay.
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
        // offsetParent null = elemento non renderizzato: un controllo dentro
        // una sezione collassata non deve entrare nel ciclo.
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

    // In fase di cattura: un input dentro la modale che ferma la
    // propagazione dei tasti non deve poter disattivare Escape.
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
