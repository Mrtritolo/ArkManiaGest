/**
 * FormPrimitives -- the one field shape the kit does not cover: a secret
 * whose stored value is never sent back, so the input means "leave alone"
 * until it is typed into, and clearing it needs an explicit action.
 */
import { useTranslation } from "react-i18next";
import { Button, Field, Input } from "../../../../components/ui";
import type { SecretMode } from "../settingsForm";
import styles from "../SettingsTab.module.css";

interface SecretFieldProps {
  label: string;
  /** Whether the backend currently holds a value for this key. */
  present: boolean;
  mode: SecretMode;
  value: string;
  onModeChange: (mode: SecretMode) => void;
  onChange: (value: string) => void;
}

export function SecretField({ label, present, mode, value, onModeChange, onChange }: SecretFieldProps) {
  const { t } = useTranslation();
  const isCleared = mode === "clear";
  const status = isCleared
    ? t("discord.settings.secret.willClear")
    : present
      ? t("discord.settings.secret.set")
      : t("discord.settings.secret.notSet");

  return (
    <div className={styles.secretRow}>
      <Field label={label} hint={status} className={styles.secretField}>
        <Input
          type="password"
          revealable
          mono
          value={isCleared ? "" : value}
          disabled={isCleared}
          // Keeps password managers from filling the admin's own panel
          // password in here, which would then be saved as the secret.
          autoComplete="new-password"
          placeholder={present && !isCleared ? t("discord.settings.secret.placeholder") : ""}
          onChange={(event) => onChange(event.target.value)}
        />
      </Field>
      {present &&
        (isCleared ? (
          <Button size="sm" className={styles.secretAction} onClick={() => onModeChange("keep")}>
            {t("discord.settings.secret.undoClear")}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="danger"
            className={styles.secretAction}
            title={t("discord.settings.secret.clearTitle")}
            onClick={() => onModeChange("clear")}
          >
            {t("discord.settings.secret.clear")}
          </Button>
        ))}
    </div>
  );
}
