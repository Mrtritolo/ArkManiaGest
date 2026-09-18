/**
 * CharacterHero -- the ARK character behind the Discord account: name, VIP,
 * tribe, last seen and the permission groups that are currently granted.
 */
import { useTranslation } from "react-i18next";
import { Clock, Crown, Shield } from "lucide-react";
import { Avatar, Badge, Card, StatusBadge } from "../../../components/ui";
import type { DashboardCharacter, DashboardPresence } from "../../../services/api";
import { fmtMinutes, fmtRelative } from "../dashboardFormat";
import styles from "../PlayerDashboardPage.module.css";

export function CharacterHero({ character, presence }: {
  character: DashboardCharacter;
  presence: DashboardPresence;
}) {
  const { t } = useTranslation();
  const activeTimed = character.timed_permission_groups.filter(g => !g.expired);
  const isVip = character.permission_groups.includes("VIP")
    || activeTimed.some(g => g.group === "VIP");
  const vipExpiry = activeTimed.find(g => g.group === "VIP")?.expires_at_iso ?? null;
  const fixedGroups = character.permission_groups.filter(g => g !== "VIP");
  const name = character.name || t("dashboard.unknownPlayer");

  return (
    <Card>
      <div className={styles.stack}>
        <div className={styles.identity}>
          <Avatar name={name} size="lg" />
          <div className={styles.identityText}>
            <div className="l-cluster">
              <span className={styles.greeting}>{name}</span>
              {isVip && (
                <Badge tone="warning" icon={Crown}>
                  {vipExpiry
                    ? `VIP · ${t("dashboard.character.expires", { r: fmtRelative(vipExpiry, t) })}`
                    : "VIP"}
                </Badge>
              )}
              {presence.online_now && <StatusBadge status="online" />}
            </div>
            <dl className="ui-dl">
              <dt>{t("dashboard.character.tribeLabel")}</dt>
              <dd>
                {character.tribe_name
                  ? character.tribe_name + (character.tribe_id ? ` (#${character.tribe_id})` : "")
                  : t("dashboard.character.noTribe")}
              </dd>
              <dt>{t("dashboard.character.presenceLabel")}</dt>
              <dd>
                {presence.online_now
                  ? t("dashboard.header.connectedFor", { m: fmtMinutes(presence.duration_minutes) })
                  : t("dashboard.character.lastSeen", { r: fmtRelative(character.last_login, t) })}
              </dd>
            </dl>
          </div>
        </div>

        {fixedGroups.length > 0 && (
          <div className="l-cluster">
            <span className="u-secondary u-text-sm">{t("dashboard.character.groupsLabel")}</span>
            {fixedGroups.map(g => (
              <Badge key={g} icon={Shield}>{g}</Badge>
            ))}
          </div>
        )}

        {activeTimed.length > 0 && (
          <div className="l-cluster">
            <span className="u-secondary u-text-sm">{t("dashboard.character.timedShort")}</span>
            {activeTimed.map((g, i) => (
              <Badge key={`${g.group}-${i}`} tone="success" icon={Clock}>
                {g.group} · {t("dashboard.character.expires", { r: fmtRelative(g.expires_at_iso, t) })}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
