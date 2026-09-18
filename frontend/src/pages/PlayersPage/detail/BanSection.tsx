/**
 * BanSection — the inline ban form of the detail panel.
 *
 * The player name is interpolated through <Trans> (escapeValue on, then
 * unescaped as text): it is player-controlled and must never become markup.
 */
import { Trans, useTranslation } from "react-i18next";
import { ShieldOff } from "lucide-react";
import { Alert, Button, Field, Input, SegmentedControl } from "../../../components/ui";
import type { PlayerFull } from "../../../types";
import type { BanDuration } from "../hooks/useBanPlayer";
import styles from "../PlayersPage.module.css";

export interface BanSectionProps {
  player: PlayerFull;
  reason: string;
  onReasonChange: (value: string) => void;
  duration: BanDuration;
  onDurationChange: (value: BanDuration) => void;
  banning: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function BanSection({
  player,
  reason,
  onReasonChange,
  duration,
  onDurationChange,
  banning,
  onConfirm,
  onCancel,
}: BanSectionProps) {
  const { t } = useTranslation();
  return (
    <section className={styles.section} aria-labelledby="players-ban-section">
      <h3 className={styles.sectionTitle} id="players-ban-section">
        <ShieldOff aria-hidden="true" /> {t("players.ban.sectionTitle")}
      </h3>
      <Alert tone="danger">
        <Trans
          i18nKey="players.ban.intro"
          values={{ name: player.name || player.eos_id }}
          components={{ strong: <strong /> }}
          tOptions={{ interpolation: { escapeValue: true } }}
          shouldUnescape
        />
      </Alert>
      <Field label={t("players.ban.reasonLabel")}>
        <Input
          value={reason}
          placeholder={t("players.ban.reasonPlaceholder")}
          onChange={e => onReasonChange(e.target.value)}
        />
      </Field>
      <SegmentedControl
        label={t("players.ban.durationLabel")}
        size="sm"
        options={[
          { value: "permanent", label: t("players.ban.permanent") },
          { value: "1d", label: t("players.ban.oneDay") },
          { value: "3d", label: t("players.ban.threeDays") },
          { value: "7d", label: t("players.ban.sevenDays") },
          { value: "30d", label: t("players.ban.thirtyDays") },
        ]}
        value={duration}
        onChange={onDurationChange}
      />
      <div className="l-cluster">
        <Button onClick={onCancel} disabled={banning}>
          {t("players.ban.cancel")}
        </Button>
        <Button
          variant="danger"
          icon={ShieldOff}
          className="u-push"
          loading={banning}
          loadingLabel={t("players.ban.banning")}
          onClick={onConfirm}
        >
          {t("players.ban.confirmBan")}
        </Button>
      </div>
    </section>
  );
}
