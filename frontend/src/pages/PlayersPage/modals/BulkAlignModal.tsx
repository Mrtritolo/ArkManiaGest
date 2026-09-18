/**
 * BulkAlignModal — pick a family of related timed permissions and align the
 * expiry of every ACTIVE entry in that family per player.
 *
 * The quick picks come from the groups actually present in the loaded players
 * (so typos are impossible); a free-text box adds a group that does not exist
 * on any player yet. The chosen family is persisted by the hook.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Save } from "lucide-react";
import { Alert, Button, Checkbox, Field, Input, Modal } from "../../../components/ui";

export interface BulkAlignModalProps {
  open: boolean;
  onClose: () => void;
  selectedCount: number;
  /** Distinct timed groups across the loaded players, plus the persisted ones. */
  familyOptions: string[];
  alignGroups: string[];
  onToggleGroup: (name: string) => void;
  onAddGroup: (name: string) => void;
  applying: boolean;
  onApply: () => void;
}

export function BulkAlignModal({
  open,
  onClose,
  selectedCount,
  familyOptions,
  alignGroups,
  onToggleGroup,
  onAddGroup,
  applying,
  onApply,
}: BulkAlignModalProps) {
  const { t } = useTranslation();
  const [custom, setCustom] = useState("");

  function addCustom() {
    const value = custom.trim();
    if (!value) return;
    onAddGroup(value);
    setCustom("");
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!applying}
      title={t("players.bulkAlign.modalTitle", { count: selectedCount })}
      description={t("players.bulkAlign.modalHint")}
      size="md"
      onSubmit={onApply}
      footer={
        <>
          <Button onClick={onClose} disabled={applying}>
            {t("players.bulkAlign.cancel")}
          </Button>
          <Button
            type="submit"
            variant="primary"
            icon={Save}
            disabled={alignGroups.length < 2}
            loading={applying}
            loadingLabel={t("players.bulkAlign.applying")}
          >
            {t("players.bulkAlign.apply", { count: selectedCount })}
          </Button>
        </>
      }
    >
      <div className="l-stack">
        <fieldset className="ui-fieldset">
          <legend>{t("players.bulkAlign.familyLabel")}</legend>
          {familyOptions.length === 0 ? (
            <p className="u-muted u-text-sm">{t("players.bulkAlign.noFamilyOptions")}</p>
          ) : (
            <div className="l-cluster">
              {familyOptions.map(name => (
                <Checkbox
                  key={name}
                  label={name}
                  checked={alignGroups.includes(name)}
                  onChange={() => onToggleGroup(name)}
                />
              ))}
            </div>
          )}
        </fieldset>

        <div className="l-cluster">
          <Field label={t("players.bulkAlign.addLabel")} hint={t("players.bulkAlign.addHint")}>
            <Input
              value={custom}
              placeholder={t("players.bulkAlign.addPlaceholder")}
              onChange={e => setCustom(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  // Enter adds the group instead of submitting the dialog.
                  e.preventDefault();
                  addCustom();
                }
              }}
            />
          </Field>
          <Button size="sm" icon={Plus} disabled={!custom.trim()} onClick={addCustom}>
            {t("players.bulkAlign.addButton")}
          </Button>
        </div>

        {/* The four rules were one \n-separated string written for a native
            confirm box; inside an Alert the newlines collapse, so they are a
            real list of four keys instead. */}
        <Alert tone="info" title={t("players.bulkAlign.rules.title")}>
          <ul className="l-stack l-stack--sm">
            <li>{t("players.bulkAlign.rules.latest")}</li>
            <li>{t("players.bulkAlign.rules.bump")}</li>
            <li>{t("players.bulkAlign.rules.expired")}</li>
            <li>{t("players.bulkAlign.rules.skipped")}</li>
          </ul>
        </Alert>
      </div>
    </Modal>
  );
}
