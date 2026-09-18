/**
 * PermissionsSection — the fixed `PermissionGroups` chips and the timed
 * `TimedPermissionGroups` editor.
 *
 * Fixed groups are matched on whole comma-separated tokens: a substring match
 * made 'VIP' look active on 'VIPPlus' and removing it left 'Plus' behind.
 */
import { useTranslation } from "react-i18next";
import { Clock, Plus, Save, Shield, X } from "lucide-react";
import { Badge, Button, Field, IconButton, Input } from "../../../components/ui";
import type { PermissionGroupItem } from "../../../types";
import { inputToTs, parseFixedGroups, tsToInput, type TimedPerm } from "../playersUtils";
import styles from "../PlayersPage.module.css";

const EXTENSIONS: Array<{ labelKey: string; seconds: number }> = [
  { labelKey: "players.perms.extend7d", seconds: 7 * 24 * 3600 },
  { labelKey: "players.perms.extend1m", seconds: 30 * 24 * 3600 },
  { labelKey: "players.perms.extend3m", seconds: 90 * 24 * 3600 },
  { labelKey: "players.perms.extend12m", seconds: 365 * 24 * 3600 },
];

export interface PermissionsSectionProps {
  canOperate: boolean;
  readOnlyTitle?: string;
  groups: PermissionGroupItem[];
  permInput: string;
  onPermInputChange: (value: string) => void;
  savingFixed: boolean;
  onSaveFixed: () => void;
  timedPerms: TimedPerm[];
  onTimedChange: (index: number, field: keyof TimedPerm, value: string | number) => void;
  onRemoveTimed: (index: number) => void;
  onAddTimed: (group: string) => void;
  savingTimed: boolean;
  onSaveTimed: () => void;
}

export function PermissionsSection(p: PermissionsSectionProps) {
  const { t } = useTranslation();
  const current = parseFixedGroups(p.permInput);

  return (
    <>
      <section className={styles.section} aria-labelledby="players-fixed-perms">
        <h3 className={styles.sectionTitle} id="players-fixed-perms">
          <Shield aria-hidden="true" /> {t("players.perms.sectionTitle")}
        </h3>
        <div className="l-cluster">
          {p.groups.map(g => {
            const active = current.includes(g.group_name);
            return (
              <Button
                key={g.id}
                size="sm"
                pressed={active}
                disabled={!p.canOperate}
                title={p.readOnlyTitle}
                onClick={() => {
                  const next = active
                    ? current.filter(name => name !== g.group_name)
                    : [...current, g.group_name];
                  p.onPermInputChange(next.length > 0 ? next.join(",") + "," : "");
                }}
              >
                {g.group_name}
              </Button>
            );
          })}
        </div>
        {p.canOperate && (
          <Button
            variant="primary"
            icon={Save}
            loading={p.savingFixed}
            loadingLabel={t("players.perms.save")}
            onClick={p.onSaveFixed}
          >
            {t("players.perms.save")}
          </Button>
        )}
      </section>

      <section className={styles.section} aria-labelledby="players-timed-perms">
        <h3 className={styles.sectionTitle} id="players-timed-perms">
          <Clock aria-hidden="true" /> {t("players.perms.timedSectionTitle")}
        </h3>
        {p.timedPerms.length === 0 ? (
          <p className="u-muted u-text-sm">{t("players.perms.emptyTimed")}</p>
        ) : (
          <div className="l-stack l-stack--sm">
            {p.timedPerms.map((tp, i) => {
              const expired = tp.timestamp ? new Date(tp.timestamp * 1000) < new Date() : false;
              return (
                <div key={i} className={styles.timedItem}>
                  <div className={styles.timedHead}>
                    <span className={styles.timedGroup}>{tp.group}</span>
                    <Badge tone={expired ? "neutral" : "success"}>
                      {expired ? t("players.perms.expired") : t("players.perms.active")}
                    </Badge>
                  </div>
                  <div className={styles.timedFields}>
                    <Field label={t("players.perms.flagLabel")}>
                      <Input
                        size="sm"
                        value={tp.flag}
                        disabled={!p.canOperate}
                        title={p.readOnlyTitle}
                        onChange={e => p.onTimedChange(i, "flag", e.target.value)}
                      />
                    </Field>
                    <Field label={t("players.perms.expiresLabel")}>
                      <Input
                        size="sm"
                        type="datetime-local"
                        value={tsToInput(tp.timestamp)}
                        disabled={!p.canOperate}
                        title={p.readOnlyTitle}
                        onChange={e => p.onTimedChange(i, "timestamp", inputToTs(e.target.value))}
                      />
                    </Field>
                  </div>
                  {p.canOperate && (
                    <div className="l-cluster">
                      {EXTENSIONS.map(ext => (
                        <Button
                          key={ext.labelKey}
                          size="sm"
                          aria-label={t("players.perms.extendTitle", { group: tp.group, amount: t(ext.labelKey) })}
                          title={t("players.perms.extendTitle", { group: tp.group, amount: t(ext.labelKey) })}
                          onClick={() => p.onTimedChange(i, "timestamp", tp.timestamp + ext.seconds)}
                        >
                          {t(ext.labelKey)}
                        </Button>
                      ))}
                      <IconButton
                        size="sm"
                        icon={X}
                        tone="danger"
                        className="u-push"
                        label={t("players.perms.removeTimed", { group: tp.group })}
                        onClick={() => p.onRemoveTimed(i)}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {p.canOperate && (
          <>
            <div className="l-cluster">
              {p.groups
                .filter(g => !p.timedPerms.some(tp => tp.group === g.group_name))
                .map(g => (
                  <Button
                    key={g.id}
                    size="sm"
                    icon={Plus}
                    aria-label={t("players.perms.addTimed", { group: g.group_name })}
                    title={t("players.perms.addTimed", { group: g.group_name })}
                    onClick={() => p.onAddTimed(g.group_name)}
                  >
                    {g.group_name}
                  </Button>
                ))}
            </div>
            <Button
              variant="primary"
              icon={Save}
              loading={p.savingTimed}
              loadingLabel={t("players.perms.saveTimed")}
              onClick={p.onSaveTimed}
            >
              {t("players.perms.saveTimed")}
            </Button>
          </>
        )}
      </section>
    </>
  );
}
