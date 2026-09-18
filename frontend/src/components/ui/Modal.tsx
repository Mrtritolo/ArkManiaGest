import { useId, useRef, type FormEvent, type ReactNode, type RefObject, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useDialogFocus } from "../../hooks/useDialogFocus";
import { cx } from "./cx";
import { IconButton } from "./IconButton";
import "./Modal.css";

export interface ModalProps {
  /** Closed renders nothing: keep form state in the page. */
  open: boolean;
  /** The page may ask useConfirm here when the form is dirty. */
  onClose: () => void;
  title: string;
  description?: ReactNode;
  /** 460 / 560 / 760px, always within the viewport minus 32px. */
  size?: "sm" | "md" | "lg";
  /** DOM order = visual order at every width: Cancel (secondary) then confirm. */
  footer?: ReactNode;
  /** Default true. Pass false while busy: Escape, X and backdrop are ignored. */
  dismissible?: boolean;
  initialFocusRef?: RefObject<HTMLElement>;
  /**
   * Form dialogs: body and footer become one <form noValidate>, so Enter in a
   * field and a footer <Button type="submit"> both submit. Modal calls
   * preventDefault and stops the event from bubbling (through the portal) to
   * a page <form> that rendered the dialog.
   */
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  children?: ReactNode;
}

/**
 * The only overlay dialog. Portal on document.body, inert background, scroll
 * lock, focus in/trap/restore and top-most-only Escape via useDialogFocus (which
 * builds on hooks/useModalA11y). Errors raised while it is open belong inside
 * the body as an Alert.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  size = "md",
  footer,
  dismissible = true,
  initialFocusRef,
  onSubmit,
  children,
}: ModalProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const descId = useId();
  const overlayRef = useRef<HTMLDivElement>(null);
  // Close on a backdrop click only when the press both started and ended on
  // the backdrop, so a text selection dragged out of the panel never closes.
  const press = useRef({ down: false, up: false });
  const { panelProps } = useDialogFocus(open, { onClose, dismissible, initialFocusRef, rootRef: overlayRef });

  if (!open) return null;

  const onBackdrop = (event: SyntheticEvent<HTMLDivElement>) => event.target === event.currentTarget;

  const content = (
    <>
      <div className="ui-modal__body">
        {description !== undefined && (
          <div className="ui-modal__description" id={descId}>
            {description}
          </div>
        )}
        {children}
      </div>
      {footer !== undefined && <div className="ui-modal__footer">{footer}</div>}
    </>
  );

  return createPortal(
    <div
      ref={overlayRef}
      className="ui-modal"
      onPointerDown={event => {
        press.current = { down: onBackdrop(event), up: false };
      }}
      onPointerUp={event => {
        press.current.up = onBackdrop(event);
      }}
      onClick={event => {
        // Portal events bubble through the React tree: never let a click in
        // the dialog reach a clickable row or card that rendered it.
        event.stopPropagation();
        const { down, up } = press.current;
        press.current = { down: false, up: false };
        if (down && up && onBackdrop(event) && dismissible) onClose();
      }}
    >
      <div
        {...panelProps}
        className={cx("ui-modal__panel", `ui-modal__panel--${size}`)}
        aria-labelledby={titleId}
        aria-describedby={description !== undefined ? descId : undefined}
      >
        <div className="ui-modal__header">
          <h2 className="ui-modal__title" id={titleId}>
            {title}
          </h2>
          <IconButton size="sm" icon={X} label={t("common.close")} disabled={!dismissible} onClick={onClose} />
        </div>
        {onSubmit ? (
          <form
            className="ui-modal__form"
            noValidate
            onSubmit={event => {
              event.preventDefault();
              event.stopPropagation();
              onSubmit(event);
            }}
          >
            {content}
          </form>
        ) : (
          content
        )}
      </div>
    </div>,
    document.body,
  );
}
