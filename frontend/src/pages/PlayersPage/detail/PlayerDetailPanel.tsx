/**
 * PlayerDetailPanel — the aside of the master-detail layout.
 *
 * It is deliberately NOT keyed on the player id: the ban form, the maps result
 * and the copy form survive a switch between players exactly as before (their
 * state lives in page-level hooks and openDetail resets what must be reset).
 */
import { useTranslation } from "react-i18next";
import { Calendar, CreditCard, Home, Skull, X, ShieldOff } from "lucide-react";
import { Avatar, Card, CopyButton, IconButton, Spinner } from "../../../components/ui";
import { fmtLocaleDateTime } from "../../../utils/format";
import type { PermissionGroupItem, PlayerFull } from "../../../types";
import type { SyncContainer } from "../../../services/api";
import type { BanPlayer } from "../hooks/useBanPlayer";
import type { PlayerDetail } from "../hooks/usePlayerDetail";
import type { PlayerMaps } from "../hooks/usePlayerMaps";
import { BanSection } from "./BanSection";
import { MapsCopySection } from "./MapsCopySection";
import { PermissionsSection } from "./PermissionsSection";
import { PointsSection } from "./PointsSection";
import styles from "../PlayersPage.module.css";

export interface PlayerDetailPanelProps {
  player: PlayerFull;
  canOperate: boolean;
  isAdmin: boolean;
  readOnlyTitle?: string;
  detail: PlayerDetail;
  ban: BanPlayer;
  maps: PlayerMaps;
  groups: PermissionGroupItem[];
  syncContainers: SyncContainer[];
  onOpenWipe: () => void;
}

export function PlayerDetailPanel({
  player,
  canOperate,
  isAdmin,
  readOnlyTitle,
  detail,
  ban,
  maps,
  groups,
  syncContainers,
  onOpenWipe,
}: PlayerDetailPanelProps) {
  const { t } = useTranslation();
  const name = player.name || t("players.unknownPlayer");

  return (
    <Card
      title={
        <span className={styles.nameCell}>
          <Avatar name={name} size="md" />
          {name}
        </span>
      }
      actions={
        <>
          {detail.detailLoading && <Spinner />}
          {canOperate && (
            <IconButton
              size="sm"
              icon={ShieldOff}
              tone="danger"
              label={t("players.detail.banTooltip")}
              pressed={ban.showBanDialog}
              onClick={() => ban.setShowBanDialog(!ban.showBanDialog)}
            />
          )}
          {isAdmin && (
            <IconButton size="sm" icon={Skull} tone="danger" label={t("players.detail.wipeTooltip")} onClick={onOpenWipe} />
          )}
          <IconButton size="sm" icon={X} label={t("players.detail.closeTooltip")} onClick={detail.closeDetail} />
        </>
      }
    >
      <div className="l-stack">
        <div className={styles.chipRow}>
          <span className="u-mono u-text-sm u-wrap-anywhere">{player.eos_id}</span>
          <CopyButton value={player.eos_id} label={t("players.detail.copyEos")} />
        </div>

        <dl className="ui-dl">
          {player.tribe_name && (
            <>
              <dt>
                <Home size={14} strokeWidth={1.75} aria-hidden="true" /> {t("players.table.tribe")}
              </dt>
              <dd>{player.tribe_name}</dd>
            </>
          )}
          <dt>
            <Calendar size={14} strokeWidth={1.75} aria-hidden="true" /> {t("players.table.login")}
          </dt>
          <dd>{fmtLocaleDateTime(player.last_login, "--")}</dd>
          <dt>
            <CreditCard size={14} strokeWidth={1.75} aria-hidden="true" /> {t("players.detail.spentLabel")}
          </dt>
          <dd className="u-num">{player.total_spent?.toLocaleString() ?? "0"}</dd>
        </dl>

        {ban.showBanDialog && canOperate && (
          <BanSection
            player={player}
            reason={ban.banReason}
            onReasonChange={ban.setBanReason}
            duration={ban.banDuration}
            onDurationChange={ban.setBanDuration}
            banning={ban.banning}
            onConfirm={ban.handleBanPlayer}
            onCancel={() => ban.setShowBanDialog(false)}
          />
        )}

        <PointsSection
          canOperate={canOperate}
          points={player.points}
          pointsInput={detail.pointsInput}
          onPointsInputChange={detail.setPointsInput}
          saving={detail.isSaving("points")}
          onSet={detail.handleSetPoints}
          onAdd={detail.handleAddPoints}
        />

        <PermissionsSection
          canOperate={canOperate}
          readOnlyTitle={readOnlyTitle}
          groups={groups}
          permInput={detail.permInput}
          onPermInputChange={detail.setPermInput}
          savingFixed={detail.isSaving("fixed")}
          onSaveFixed={detail.handleSavePermissions}
          timedPerms={detail.timedPerms}
          onTimedChange={detail.handleTimedPermChange}
          onRemoveTimed={i => detail.setTimedPerms(prev => prev.filter((_, idx) => idx !== i))}
          onAddTimed={group =>
            detail.setTimedPerms(prev => [
              ...prev,
              { flag: "0", timestamp: Math.floor(Date.now() / 1000) + 30 * 24 * 3600, group },
            ])
          }
          savingTimed={detail.isSaving("timed")}
          onSaveTimed={detail.handleSaveTimedPermissions}
        />

        {player.kits && player.kits !== "{}" && (
          <section className={styles.section} aria-labelledby="players-kits-section">
            <h3 className={styles.sectionTitle} id="players-kits-section">
              <Skull aria-hidden="true" /> {t("players.kits.sectionTitle")}
            </h3>
            <pre className="ui-code">{player.kits}</pre>
          </section>
        )}

        <MapsCopySection canOperate={canOperate} maps={maps} syncContainers={syncContainers} />
      </div>
    </Card>
  );
}
