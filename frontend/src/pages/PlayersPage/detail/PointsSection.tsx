/**
 * PointsSection — the ArkShop balance of the selected player.
 * Viewers see the balance; only operators get the editing controls.
 */
import { useTranslation } from "react-i18next";
import { Minus, Plus, Save, Star } from "lucide-react";
import { Button, Field, Input } from "../../../components/ui";
import styles from "../PlayersPage.module.css";

export interface PointsSectionProps {
  canOperate: boolean;
  points: number | null;
  pointsInput: string;
  onPointsInputChange: (value: string) => void;
  saving: boolean;
  onSet: () => void;
  onAdd: (amount: number) => void;
}

export function PointsSection({
  canOperate,
  points,
  pointsInput,
  onPointsInputChange,
  saving,
  onSet,
  onAdd,
}: PointsSectionProps) {
  const { t } = useTranslation();
  return (
    <section className={styles.section} aria-labelledby="players-points-section">
      <h3 className={styles.sectionTitle} id="players-points-section">
        <Star aria-hidden="true" /> {t("players.points.sectionTitle")}
      </h3>
      <p className={styles.bigValue}>{points?.toLocaleString(undefined) ?? 0}</p>
      {canOperate && (
        <>
          <div className={styles.inlineForm}>
            <Field label={t("players.points.inputLabel")}>
              <Input
                type="number"
                min={0}
                size="sm"
                value={pointsInput}
                onChange={e => onPointsInputChange(e.target.value)}
              />
            </Field>
            <Button size="sm" icon={Save} loading={saving} loadingLabel={t("players.points.setButton")} onClick={onSet}>
              {t("players.points.setButton")}
            </Button>
          </div>
          <div className="l-cluster">
            {[100, 500, 1000].map(n => (
              <Button key={n} size="sm" icon={Plus} disabled={saving} onClick={() => onAdd(n)}>
                {n}
              </Button>
            ))}
            <Button size="sm" variant="danger" icon={Minus} disabled={saving} onClick={() => onAdd(-100)}>
              100
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
