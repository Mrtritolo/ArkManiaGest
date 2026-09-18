/**
 * BuyConfirmModal -- the one purchase confirmation of the page.
 *
 * Shows what is being bought, the price, the current balance and the balance
 * after, so the decision is made on numbers rather than on trust. A failed
 * purchase keeps the dialog open and puts the reason inside it: closing on
 * failure used to drop the message somewhere up the page.
 */
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { ShoppingBag } from "lucide-react";
import { Alert, Button, Modal } from "../../../components/ui";
import { Points } from "./Points";
import type { PendingBuy } from "../hooks/usePurchaseConfirm";

export function BuyConfirmModal({
  pending, busy, error, balance, onCancel, onConfirm,
}: {
  pending: PendingBuy | null;
  busy: boolean;
  error: string;
  balance: number | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const cancelRef = useRef<HTMLButtonElement>(null);

  if (!pending) return null;

  const after = balance !== null ? balance - pending.price : null;
  const short = after !== null && after < 0;

  return (
    <Modal
      open
      size="sm"
      title={t("market.buyModal.title")}
      description={pending.label}
      dismissible={!busy}
      initialFocusRef={cancelRef}
      onClose={onCancel}
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" disabled={busy} onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            icon={ShoppingBag}
            loading={busy}
            loadingLabel={t("market.buyModal.buying")}
            disabled={short}
            onClick={onConfirm}
          >
            {t("market.buyModal.confirm")}
          </Button>
        </>
      }
    >
      <dl className="ui-dl">
        <dt>{t("market.buyModal.price")}</dt>
        <dd><Points value={pending.price} /></dd>
        <dt>{t("market.buyModal.current")}</dt>
        <dd>{balance !== null ? <Points value={balance} /> : "—"}</dd>
        <dt>{t("market.buyModal.after")}</dt>
        <dd>{after !== null ? <Points value={after} /> : "—"}</dd>
      </dl>
      {short && <Alert tone="warning">{t("market.buyModal.insufficient")}</Alert>}
      {error && <Alert tone="danger" title={t("market.errors.buy")}>{error}</Alert>}
    </Modal>
  );
}
