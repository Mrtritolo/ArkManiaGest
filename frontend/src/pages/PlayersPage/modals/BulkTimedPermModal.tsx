/**
 * BulkTimedPermModal — grant / extend ONE timed permission on every selected
 * player by a delta.
 *
 * The custom-days box keeps its own text while it is being typed: clamping on
 * every keystroke turned an empty field into "1", so backspacing 7 to type 30
 * produced 130 days.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Save } from "lucide-react";
import { Alert, Button, Field, Input, Modal, Select } from "../../../components/ui";
import type { PermissionGroupItem } from "../../../types";

const PRESETS: Array<{ labelKey: string; seconds: number }> = [
  { labelKey: "players.perms.extend7d", seconds: 7 * 24 * 3600 },
  { labelKey: "players.perms.extend1m", seconds: 30 * 24 * 3600 },
  { labelKey: "players.perms.extend3m", seconds: 90 * 24 * 3600 },
  { labelKey: "players.perms.extend12m", seconds: 365 * 24 * 3600 },
];

export interface BulkTimedPermModalProps {
  open: boolean;
  onClose: () => void;
  selectedCount: number;
  groups: PermissionGroupItem[];
  group: string;
  onGroupChange: (value: string) => void;
  durationSeconds: number;
  onDurationChange: (seconds: number) => void;
  applying: boolean;
  onApply: () => void;
}

export function BulkTimedPermModal({
  open,
  onClose,
  selectedCount,
  groups,
  group,
  onGroupChange,
  durationSeconds,
  onDurationChange,
  applying,
  onApply,
}: BulkTimedPermModalProps) {
  const { t } = useTranslation();
  const [daysText, setDaysText] = useState("");

  // Re-sync the raw text every time the dialog is opened.
  useEffect(() => {
    if (open) setDaysText(String(Math.round(durationSeconds / (24 * 3600))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const days = Number(daysText);
  const daysValid = /^\d+$/.test(daysText) && days >= 1 && days <= 3650;

  function pickPreset(seconds: number) {
    onDurationChange(seconds);
    setDaysText(String(Math.round(seconds / (24 * 3600))));
  }

  function changeDays(value: string) {
    setDaysText(value);
    const n = Number(value);
    if (/^\d+$/.test(value) && n >= 1 && n <= 3650) onDurationChange(n * 24 * 3600);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!applying}
      title={t("players.bulkPerm.modalTitle", { count: selectedCount })}
      description={t("players.bulkPerm.modalHint")}
      size="md"
      onSubmit={onApply}
      footer={
        <>
          <Button onClick={onClose} disabled={applying}>
            {t("players.bulkPerm.cancel")}
          </Button>
          <Button
            type="submit"
            variant="primary"
            icon={Save}
            disabled={!group || !daysValid}
            loading={applying}
            loadingLabel={t("players.bulkPerm.applying")}
          >
            {t("players.bulkPerm.apply", { count: selectedCount })}
          </Button>
        </>
      }
    >
      <div className="l-stack">
        <Field label={t("players.bulkPerm.groupLabel")} required>
          <Select value={group} onChange={e => onGroupChange(e.target.value)}>
            <option value="">{t("players.bulkPerm.groupPlaceholder")}</option>
            {groups.map(g => (
              <option key={g.id} value={g.group_name}>
                {g.group_name}
              </option>
            ))}
          </Select>
        </Field>

        <fieldset className="ui-fieldset">
          <legend>{t("players.bulkPerm.durationLabel")}</legend>
          <div className="l-cluster">
            {PRESETS.map(preset => (
              <Button
                key={preset.labelKey}
                size="sm"
                pressed={durationSeconds === preset.seconds}
                onClick={() => pickPreset(preset.seconds)}
              >
                {t(preset.labelKey)}
              </Button>
            ))}
          </div>
          <Field
            label={t("players.bulkPerm.customDaysLabel")}
            hint={t("players.bulkPerm.customDaysSuffix")}
            error={daysText !== "" && !daysValid ? t("players.bulkPerm.customDaysInvalid") : undefined}
          >
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={3650}
              size="sm"
              value={daysText}
              onChange={e => changeDays(e.target.value)}
            />
          </Field>
        </fieldset>

        <Alert tone="info">{t("players.bulkPerm.semanticsHint")}</Alert>
      </div>
    </Modal>
  );
}
