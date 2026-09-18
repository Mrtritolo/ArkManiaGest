/**
 * PlayersHeaderActions — the action cluster of the page header: bulk grant,
 * bulk align, tribe sync, the name-sync panel toggle and refresh.
 *
 * Every write here is require_operator server side, so viewers only get the
 * refresh button.
 */
import { useTranslation } from "react-i18next";
import { ArrowUpDown, Clock, Download, RefreshCw } from "lucide-react";
import { Button, IconButton } from "../../../components/ui";

export interface PlayersHeaderActionsProps {
  canOperate: boolean;
  selectedCount: number;
  bulkApplying: boolean;
  alignApplying: boolean;
  syncing: boolean;
  syncingTribes: boolean;
  showSyncPanel: boolean;
  onOpenBulk: () => void;
  onOpenAlign: () => void;
  onSyncTribes: () => void;
  onToggleSyncPanel: () => void;
  onRefresh: () => void;
}

export function PlayersHeaderActions({
  canOperate,
  selectedCount,
  bulkApplying,
  alignApplying,
  syncing,
  syncingTribes,
  showSyncPanel,
  onOpenBulk,
  onOpenAlign,
  onSyncTribes,
  onToggleSyncPanel,
  onRefresh,
}: PlayersHeaderActionsProps) {
  const { t } = useTranslation();
  const bulkTitle = selectedCount === 0
    ? t("players.bulkPerm.headerTitleDisabled")
    : t("players.bulkPerm.headerTitleEnabled", { count: selectedCount });
  const alignTitle = selectedCount === 0
    ? t("players.bulkAlign.headerTitleDisabled")
    : t("players.bulkAlign.headerTitleEnabled", { count: selectedCount });

  return (
    <>
      {canOperate && (
        <>
          <Button
            size="sm"
            icon={Clock}
            disabled={selectedCount === 0 || bulkApplying}
            title={bulkTitle}
            onClick={onOpenBulk}
          >
            {t("players.bulkPerm.headerButton", { count: selectedCount })}
          </Button>
          <Button
            size="sm"
            icon={ArrowUpDown}
            disabled={selectedCount === 0 || alignApplying}
            title={alignTitle}
            onClick={onOpenAlign}
          >
            {t("players.bulkAlign.headerButton", { count: selectedCount })}
          </Button>
          <Button
            size="sm"
            icon={Download}
            disabled={syncing || syncingTribes}
            loading={syncingTribes}
            loadingLabel={t("players.tribeSync.running")}
            title={t("players.tribeSync.title")}
            onClick={onSyncTribes}
          >
            {t("players.tribeSync.button")}
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon={Download}
            disabled={syncing || syncingTribes}
            loading={syncing}
            loadingLabel={t("players.syncing")}
            title={t("players.syncNamesTitle")}
            aria-expanded={showSyncPanel}
            aria-controls="players-sync-panel"
            onClick={onToggleSyncPanel}
          >
            {t("players.syncNamesButton")}
          </Button>
        </>
      )}
      <IconButton icon={RefreshCw} label={t("players.refreshTooltip")} onClick={onRefresh} />
    </>
  );
}
