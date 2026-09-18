/**
 * AmbiguousNamesModal — one EOS produced several distinct names across the
 * cluster (multi-character). The admin picks one name per row; "don't update"
 * sends an empty chosen_name, which the hook filters out before submitting.
 */
import { useTranslation } from "react-i18next";
import { Save } from "lucide-react";
import { Button, Checkbox, Modal } from "../../../components/ui";
import type { SyncNamesAmbiguousEntry } from "../../../services/api";
import styles from "../PlayersPage.module.css";

export interface AmbiguousNamesModalProps {
  list: SyncNamesAmbiguousEntry[] | null;
  chosenNames: Record<number, string>;
  onChoose: (playerId: number, name: string) => void;
  applying: boolean;
  onCancel: () => void;
  onApply: () => void;
}

export function AmbiguousNamesModal({
  list,
  chosenNames,
  onChoose,
  applying,
  onCancel,
  onApply,
}: AmbiguousNamesModalProps) {
  const { t } = useTranslation();
  const open = !!list && list.length > 0;
  const chosenCount = Object.values(chosenNames).filter(v => v && v.trim()).length;

  return (
    <Modal
      open={open}
      onClose={onCancel}
      dismissible={!applying}
      title={t("players.ambiguous.title", { n: list?.length ?? 0 })}
      description={t("players.ambiguous.intro")}
      size="lg"
      onSubmit={onApply}
      footer={
        <>
          <Button onClick={onCancel} disabled={applying}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            variant="primary"
            icon={Save}
            loading={applying}
            loadingLabel={t("players.ambiguous.applying")}
          >
            {t("players.ambiguous.apply", { n: chosenCount })}
          </Button>
        </>
      }
    >
      <div className={styles.scrollList}>
        {(list ?? []).map(row => (
          <fieldset key={row.player_id} className={`ui-fieldset ${styles.pickCard}`}>
            <legend>
              <span className={styles.mono}>{row.eos_id}</span>
            </legend>
            <p className="u-text-sm u-secondary">
              {t("players.ambiguous.currentName")}
              <strong>{row.current_name || "--"}</strong>
            </p>
            {row.candidates.map((c, i) => (
              <Checkbox
                key={i}
                type="radio"
                name={`pick-${row.player_id}`}
                value={c.name}
                disabled={applying}
                checked={chosenNames[row.player_id] === c.name}
                onChange={() => onChoose(row.player_id, c.name)}
                label={c.name}
                description={<span className={styles.mono}>{c.source_path}</span>}
              />
            ))}
            <Checkbox
              type="radio"
              name={`pick-${row.player_id}`}
              value=""
              disabled={applying}
              checked={(chosenNames[row.player_id] || "") === ""}
              onChange={() => onChoose(row.player_id, "")}
              label={t("players.ambiguous.skipThis")}
            />
          </fieldset>
        ))}
      </div>
    </Modal>
  );
}
