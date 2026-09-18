import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./Button";
import { Field } from "./Field";
import { Input } from "./Input";
import { Modal } from "./Modal";

export interface ConfirmOptions {
  title: string;
  /**
   * Name the target (bold) and list affected items when relevant. It renders
   * in ConfirmProvider's tree, not the caller's: router components work
   * (the provider sits inside <BrowserRouter>), contexts provided below the
   * provider (a page's own context) do not.
   */
  description?: ReactNode;
  /** Explicit verb: 'Delete machine', never 'OK'. */
  confirmLabel: string;
  /** Default t('common.cancel'). */
  cancelLabel?: string;
  /** danger -> Button variant danger; default -> primary. */
  tone?: "danger" | "default";
  /** Typed confirmation: Confirm stays disabled until the input equals this exact string. */
  confirmText?: string;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

interface Request {
  id: number;
  options: ConfirmOptions;
  resolve: (value: boolean) => void;
}

const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * Mount once, inside ToastProvider, both inside <BrowserRouter> in App.tsx
 * (so a <Link> in a description works).
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Request[]>([]);
  const nextId = useRef(1);

  // Stable identity: pages can list confirm in effect deps safely.
  const confirm = useCallback<ConfirmFn>(
    options =>
      new Promise<boolean>(resolve => {
        const id = nextId.current++;
        setQueue(q => [...q, { id, options, resolve }]);
      }),
    [],
  );

  const settle = useCallback((request: Request, value: boolean) => {
    request.resolve(value);
    setQueue(q => q.filter(r => r.id !== request.id));
  }, []);

  const current = queue[0];

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {current && <ConfirmDialogView key={current.id} request={current} onSettle={settle} />}
    </ConfirmContext.Provider>
  );
}

/**
 * Promise-based confirmation:
 *   if (!(await confirm({ title, confirmLabel, tone: 'danger' }))) return
 */
export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error("useConfirm must be used inside <ConfirmProvider>.");
  return confirm;
}

function ConfirmDialogView({
  request,
  onSettle,
}: {
  request: Request;
  onSettle: (request: Request, value: boolean) => void;
}) {
  const { t } = useTranslation();
  const { options } = request;
  const cancelRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState("");
  const settled = useRef(false);

  const needsText = options.confirmText !== undefined;
  const canConfirm = !needsText || typed === options.confirmText;

  function finish(value: boolean) {
    if (settled.current) return;
    settled.current = true;
    onSettle(request, value);
  }

  return (
    <Modal
      open
      size="sm"
      title={options.title}
      description={options.description}
      onClose={() => finish(false)}
      initialFocusRef={needsText ? inputRef : cancelRef}
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" onClick={() => finish(false)}>
            {options.cancelLabel ?? t("common.cancel")}
          </Button>
          <Button
            variant={options.tone === "danger" ? "danger" : "primary"}
            disabled={!canConfirm}
            onClick={() => finish(true)}
          >
            {options.confirmLabel}
          </Button>
        </>
      }
    >
      {needsText && (
        <Field label={t("ui.typeToConfirm", { text: options.confirmText })}>
          <Input
            ref={inputRef}
            mono
            value={typed}
            autoComplete="off"
            spellCheck={false}
            onChange={event => setTyped(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter" && canConfirm) {
                event.preventDefault();
                finish(true);
              }
            }}
          />
        </Field>
      )}
    </Modal>
  );
}
