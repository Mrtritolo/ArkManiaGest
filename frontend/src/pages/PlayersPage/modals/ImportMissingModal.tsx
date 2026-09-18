/**
 * ImportMissingModal — bulk-insert the orphan EOS profiles found by a name
 * sync (present on disk, no row in `Players`) with the default group.
 */
import { useTranslation } from "react-i18next";
import { Download } from "lucide-react";
import { Button, Checkbox, Modal } from "../../../components/ui";
import type { OrphanProfile } from "../hooks/useNameSync";
import styles from "../PlayersPage.module.css";

export interface ImportMissingModalProps {
  open: boolean;
  onClose: () => void;
  orphans: OrphanProfile[];
  checked: Record<string, boolean>;
  onToggle: (eosId: string) => void;
  onSetAll: (on: boolean) => void;
  importing: boolean;
  onConfirm: () => void;
}

export function ImportMissingModal({
  open,
  onClose,
  orphans,
  checked,
  onToggle,
  onSetAll,
  importing,
  onConfirm,
}: ImportMissingModalProps) {
  const { t } = useTranslation();
  const selectedCount = Object.values(checked).filter(Boolean).length;

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!importing}
      title={t("players.importMissing.title", { n: orphans.length })}
      description={t("players.importMissing.intro")}
      size="lg"
      onSubmit={onConfirm}
      footer={
        <>
          <Button onClick={onClose} disabled={importing}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            variant="primary"
            icon={Download}
            disabled={selectedCount === 0}
            loading={importing}
            loadingLabel={t("players.importMissing.importing")}
          >
            {t("players.importMissing.confirm", { n: selectedCount })}
          </Button>
        </>
      }
    >
      <div className="l-stack l-stack--sm">
        <div className="l-cluster">
          <Button size="sm" disabled={importing} onClick={() => onSetAll(true)}>
            {t("players.importMissing.checkAll")}
          </Button>
          <Button size="sm" disabled={importing} onClick={() => onSetAll(false)}>
            {t("players.importMissing.uncheckAll")}
          </Button>
          <span className="u-push u-secondary u-text-sm" role="status">
            {t("players.importMissing.selectedCount", { n: selectedCount, total: orphans.length })}
          </span>
        </div>
        <div className={styles.scrollList}>
          {orphans.map(o => (
            <Checkbox
              key={o.eos_id}
              checked={!!checked[o.eos_id]}
              disabled={importing}
              onChange={() => onToggle(o.eos_id)}
              label={o.player_name || t("players.unknownPlayer")}
              description={<span className={styles.mono}>{o.eos_id}</span>}
            />
          ))}
        </div>
      </div>
    </Modal>
  );
}
