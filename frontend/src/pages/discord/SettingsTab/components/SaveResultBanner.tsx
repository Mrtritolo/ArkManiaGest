/**
 * SaveResultBanner -- what a successful save still needs from the operator.
 *
 * The result itself is a toast; this stays on screen because the values are
 * only live after a service restart, and the command is worth copying.
 */
import { useTranslation } from "react-i18next";
import { Alert, CopyButton } from "../../../../components/ui";
import type { SaveResult } from "../hooks/useDiscordSettingsForm";
import styles from "../SettingsTab.module.css";

interface Props {
  success: SaveResult | null;
}

export function SaveResultBanner({ success }: Props) {
  const { t } = useTranslation();
  if (!success) return null;

  return (
    <Alert
      tone="success"
      title={t("discord.settings.savedKeys", {
        n: success.updatedKeys.length,
        keys: success.updatedKeys.join(", "),
      })}
    >
      <div className={styles.restartHint}>
        <span>{t("discord.settings.restartHint")}</span>
        <code className="ui-code">{success.hint}</code>
        <CopyButton value={success.hint} label={t("discord.config.copy")} />
      </div>
    </Alert>
  );
}
