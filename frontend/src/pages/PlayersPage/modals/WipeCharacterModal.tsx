/**
 * WipeCharacterModal — cluster-wide .arkprofile wipe, admin only.
 *
 * Step 1 previews every file the DELETE would remove; step 2 asks for a typed
 * confirmation (useConfirm with confirmText) before it runs. The dialog is
 * bound to the player it was opened for, not to the panel's current player.
 */
import { useTranslation } from "react-i18next";
import { Skull } from "lucide-react";
import { Alert, Button, CopyButton, Modal, Spinner } from "../../../components/ui";
import type { WipePreview, WipeTarget } from "../hooks/useCharacterWipe";
import styles from "../PlayersPage.module.css";

export interface WipeCharacterModalProps {
  open: boolean;
  target: WipeTarget | null;
  preview: WipePreview | null;
  loading: boolean;
  wiping: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function WipeCharacterModal({
  open,
  target,
  preview,
  loading,
  wiping,
  onClose,
  onConfirm,
}: WipeCharacterModalProps) {
  const { t } = useTranslation();

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!wiping}
      title={t("players.wipe.title")}
      size="lg"
      footer={
        <>
          <Button onClick={onClose} disabled={wiping}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="danger"
            icon={Skull}
            disabled={loading || !preview || preview.total_files === 0}
            loading={wiping}
            loadingLabel={t("players.wipe.deleting")}
            onClick={onConfirm}
          >
            {t("players.wipe.confirm", { n: preview?.total_files ?? 0 })}
          </Button>
        </>
      }
    >
      <div className="l-stack">
        <Alert tone="danger" title={t("players.wipe.title")}>
          {t("players.wipe.intro")}
        </Alert>

        <dl className="ui-dl">
          <dt>{t("players.wipe.player")}</dt>
          <dd>{target?.name || t("players.unknownPlayer")}</dd>
          <dt>{t("bans.detail.eosId")}</dt>
          <dd className={styles.chipRow}>
            <span className={styles.mono}>{target?.eos_id}</span>
            {target && <CopyButton value={target.eos_id} label={t("players.detail.copyEos")} />}
          </dd>
        </dl>

        {loading || !preview ? (
          <Spinner block label={t("players.wipe.scanning")} />
        ) : preview.total_files === 0 ? (
          <p className="u-secondary">{t("players.wipe.noFiles")}</p>
        ) : (
          <>
            <p>
              <strong>{t("players.wipe.found", { n: preview.total_files })}</strong>
            </p>
            <div className={styles.scrollList}>
              {preview.files.map((f, i) => (
                <span key={i} className={styles.mono}>
                  {f.path}
                </span>
              ))}
            </div>
            {preview.errors.length > 0 && (
              <Alert tone="warning" title={t("players.wipe.previewErrors")}>
                <ul className="l-stack l-stack--sm">
                  {preview.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </Alert>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
