/**
 * PlayersPage — ARK player management (master-detail).
 *
 * The shell owns the committed search filter, the page-level load error and
 * the Discord quick-action target; everything else lives in the hooks under
 * ./hooks, which are called in dependency order (data, detail, then maps, ban,
 * wipe, bulk and sync) and never behind a condition.
 *
 * Role split, mirroring the backend: player edits, bans, syncs, imports and
 * character copies are require_operator; the cluster-wide character wipe is
 * require_admin. The backend stays the authority — this only hides or disables
 * what a role would get a 403 from.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, Users } from "lucide-react";
import { Alert, Button, Card, PageHeader, Spinner, useConfirm, useToast } from "../../components/ui";
import { useSelection } from "../../hooks/useSelection";
import type { AuthUser, PlayerListItem } from "../../types";
import type { DiscordAccount } from "../../services/api";
import { NO_VALUE_KEY } from "./playersUtils";
import { usePlayersData } from "./hooks/usePlayersData";
import { useColumnFilters } from "./hooks/useColumnFilters";
import { usePlayerDetail } from "./hooks/usePlayerDetail";
import { usePlayerMaps } from "./hooks/usePlayerMaps";
import { useBanPlayer } from "./hooks/useBanPlayer";
import { useCharacterWipe } from "./hooks/useCharacterWipe";
import { useBulkTimedPerms } from "./hooks/useBulkTimedPerms";
import { useNameSync } from "./hooks/useNameSync";
import { PlayersHeaderActions } from "./components/PlayersHeader";
import { OrphanProfilesBanner, SyncPanel, SyncResultBanner } from "./components/SyncPanel";
import { PlayersSearchBar, PlayersStatsTiles } from "./components/PlayersToolbar";
import { PlayersTable } from "./components/PlayersTable";
import { PlayerDetailPanel } from "./detail/PlayerDetailPanel";
import { BulkTimedPermModal } from "./modals/BulkTimedPermModal";
import { BulkAlignModal } from "./modals/BulkAlignModal";
import { AmbiguousNamesModal } from "./modals/AmbiguousNamesModal";
import {
  DiscordQuickActionModal,
  type DiscordQuickActionTarget,
} from "./modals/DiscordQuickActionModal";
import { ImportMissingModal } from "./modals/ImportMissingModal";
import { WipeCharacterModal } from "./modals/WipeCharacterModal";

/** Backend cap of GET /players — the table says so when it is reached. */
const LIST_LIMIT = 500;

interface Props {
  currentUser?: AuthUser | null;
}

export default function PlayersPage({ currentUser }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();

  const isAdmin = currentUser?.role === "admin";
  const canOperate = isAdmin || currentUser?.role === "operator";
  // Viewers still see the permission values, as disabled controls that say why.
  const permsReadOnlyTitle = canOperate ? undefined : t("players.perms.readOnlyRole");

  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [listError, setListError] = useState("");
  const [discordChipFor, setDiscordChipFor] = useState<DiscordQuickActionTarget | null>(null);

  const data = usePlayersData({ setListError, t });
  const filters = useColumnFilters(data.players);
  const selection = useSelection<number>(filters.visibleIds);

  // openDetail must reset the maps panel and the ban form of the previous
  // player. Those live in hooks declared after usePlayerDetail, so the shell
  // wires them through a ref that is filled on mount.
  const onOpenResetRef = useRef<() => void>(() => undefined);
  const onBeforeOpen = useCallback(() => onOpenResetRef.current(), []);

  const detail = usePlayerDetail({
    canOperate,
    toast,
    confirm,
    loadPlayers: data.loadPlayers,
    loadStats: data.loadStats,
    onBeforeOpen,
    t,
  });
  const maps = usePlayerMaps({
    selectedPlayer: detail.selectedPlayer,
    shownPlayerRef: detail.shownPlayerRef,
    syncContainers: data.syncContainers,
    toast,
    t,
  });
  const ban = useBanPlayer({ selectedPlayer: detail.selectedPlayer, toast, t });
  const wipe = useCharacterWipe({ selectedPlayer: detail.selectedPlayer, toast, confirm, t });
  const bulk = useBulkTimedPerms({
    selection,
    toast,
    loadPlayers: data.loadPlayers,
    reloadShownPlayerIfIn: detail.reloadShownPlayerIfIn,
    t,
  });
  const sync = useNameSync({ toast, loadPlayers: data.loadPlayers, loadStats: data.loadStats, t });

  useEffect(() => {
    onOpenResetRef.current = () => {
      maps.reset();
      ban.closeDialog();
    };
  }, [maps.reset, ban.closeDialog]);

  const familyOptions = useMemo(
    () =>
      Array.from(
        new Set([
          ...filters.distinctValues.timedActive.filter(g => g !== NO_VALUE_KEY),
          ...filters.distinctValues.timedExpired.filter(g => g !== NO_VALUE_KEY),
          // Persisted entries always show, even with no player carrying them.
          ...bulk.alignGroups,
        ]),
      ).sort((a, b) => a.localeCompare(b)),
    [filters.distinctValues, bulk.alignGroups],
  );

  const truncated = data.players.length >= LIST_LIMIT;
  const showAside = detail.selectedPlayer !== null || detail.detailLoading;

  function handleOpenDiscordChip(player: PlayerListItem, account: DiscordAccount) {
    setDiscordChipFor({ player, account });
  }

  return (
    <div className="l-page">
      <PageHeader
        title={t("players.heading")}
        icon={Users}
        description={
          <>
            {t("players.subtitle")}
            {data.stats && (
              <span className="u-muted"> · {t("players.registeredCount", { count: data.stats.total_players })}</span>
            )}
          </>
        }
        actions={
          <PlayersHeaderActions
            canOperate={canOperate}
            selectedCount={selection.count}
            bulkApplying={bulk.bulkApplying}
            alignApplying={bulk.alignApplying}
            syncing={sync.syncing}
            syncingTribes={sync.syncingTribes}
            showSyncPanel={sync.showSyncPanel}
            onOpenBulk={bulk.openBulkModal}
            onOpenAlign={() => bulk.setAlignModalOpen(true)}
            onSyncTribes={sync.handleSyncTribes}
            onToggleSyncPanel={() => sync.setShowSyncPanel(!sync.showSyncPanel)}
            onRefresh={() => {
              data.loadPlayers();
              data.loadStats();
            }}
          />
        }
      />

      {listError && (
        <Alert
          tone="danger"
          title={t("players.errors.load")}
          onDismiss={() => setListError("")}
          actions={
            <Button size="sm" icon={RefreshCw} onClick={() => data.loadPlayers()}>
              {t("common.retry")}
            </Button>
          }
        >
          {listError}
        </Alert>
      )}

      <div id="players-sync-panel">
        {sync.showSyncPanel && (
          <SyncPanel
            containers={data.syncContainers}
            syncing={sync.syncing}
            onSyncAll={() => sync.handleSyncNames()}
            onSyncOne={(machineId, containerName) => sync.handleSyncNames(machineId, containerName)}
            onClose={() => sync.setShowSyncPanel(false)}
          />
        )}
      </div>

      {sync.syncResult && <SyncResultBanner result={sync.syncResult} onDismiss={() => sync.setSyncResult(null)} />}

      {sync.notMatchedList.length > 0 && (
        <OrphanProfilesBanner
          count={sync.notMatchedList.length}
          canOperate={canOperate}
          onOpenImport={() => sync.setImportModalOpen(true)}
          onDismiss={() => sync.setNotMatchedList([])}
        />
      )}

      <PlayersStatsTiles stats={data.stats} />

      {truncated && (
        <Alert tone="info" title={t("players.truncatedTitle")}>
          {t("players.truncatedBody", { shown: data.players.length })}
        </Alert>
      )}

      <div className={showAside ? "l-split" : "l-stack"}>
        <Card
          title={t("players.listTitle")}
          flush
          actions={
            <>
              {data.refreshing && <Spinner />}
              <span className="u-secondary u-text-sm" role="status">
                {selection.count === 0 ? t("ui.noneSelected") : t("ui.selectedCount", { count: selection.count })}
              </span>
              <PlayersSearchBar
                search={search}
                onSearchChange={setSearch}
                groupFilter={groupFilter}
                groups={data.groups}
                onGroupChange={value => {
                  setGroupFilter(value);
                  data.loadPlayers(search, value);
                }}
                onSubmit={() => data.loadPlayers(search, groupFilter)}
              />
            </>
          }
        >
          <PlayersTable
            loading={data.loading}
            rows={filters.sortedPlayers}
            hasPlayers={data.players.length > 0}
            selection={selection}
            activePlayerId={detail.selectedPlayer?.id ?? null}
            sort={filters.sort}
            onSort={filters.toggleSort}
            colFilters={filters.colFilters}
            openFilter={filters.openFilter}
            distinctValues={filters.distinctValues}
            activeCount={filters.activeCount}
            onSetOpenFilter={filters.setOpenFilter}
            onToggleColFilterValue={filters.toggleColFilterValue}
            onSetColFilterAll={filters.setColFilterAll}
            onClearColFilter={filters.clearColFilter}
            discordByEos={data.discordByEos}
            onOpenDetail={detail.openDetail}
            onOpenDiscordChip={handleOpenDiscordChip}
          />
        </Card>

        {showAside &&
          (detail.selectedPlayer ? (
            <PlayerDetailPanel
              player={detail.selectedPlayer}
              canOperate={canOperate}
              isAdmin={isAdmin}
              readOnlyTitle={permsReadOnlyTitle}
              detail={detail}
              ban={ban}
              maps={maps}
              groups={data.groups}
              syncContainers={data.syncContainers}
              onOpenWipe={wipe.openWipeModal}
            />
          ) : (
            <Card title={t("players.detail.loadingTitle")}>
              <Spinner block label={t("players.loadingDetail")} />
            </Card>
          ))}
      </div>

      <BulkTimedPermModal
        open={bulk.bulkModalOpen}
        onClose={() => bulk.setBulkModalOpen(false)}
        selectedCount={selection.count}
        groups={data.groups}
        group={bulk.bulkGroup}
        onGroupChange={bulk.setBulkGroup}
        durationSeconds={bulk.bulkDurationSeconds}
        onDurationChange={bulk.setBulkDurationSeconds}
        applying={bulk.bulkApplying}
        onApply={bulk.handleBulkApply}
      />

      <BulkAlignModal
        open={bulk.alignModalOpen}
        onClose={() => bulk.setAlignModalOpen(false)}
        selectedCount={selection.count}
        familyOptions={familyOptions}
        alignGroups={bulk.alignGroups}
        onToggleGroup={bulk.toggleAlignGroup}
        onAddGroup={bulk.addAlignGroup}
        applying={bulk.alignApplying}
        onApply={bulk.handleBulkAlign}
      />

      <AmbiguousNamesModal
        list={sync.ambiguousList}
        chosenNames={sync.chosenNames}
        onChoose={(playerId, name) => sync.setChosenNames(prev => ({ ...prev, [playerId]: name }))}
        applying={sync.applyingAmbig}
        onCancel={sync.closeAmbiguous}
        onApply={sync.applyAmbiguousResolutions}
      />

      <DiscordQuickActionModal
        target={discordChipFor}
        onClose={() => setDiscordChipFor(null)}
        onSent={message => toast.success(message)}
        onError={message => toast.error(message)}
      />

      <ImportMissingModal
        open={sync.importModalOpen}
        onClose={() => sync.setImportModalOpen(false)}
        orphans={sync.notMatchedList}
        checked={sync.importChecked}
        onToggle={eosId => sync.setImportChecked(prev => ({ ...prev, [eosId]: !prev[eosId] }))}
        onSetAll={on =>
          sync.setImportChecked(
            on ? Object.fromEntries(sync.notMatchedList.map(o => [o.eos_id, true])) : {},
          )
        }
        importing={sync.importing}
        onConfirm={sync.applyImportMissing}
      />

      <WipeCharacterModal
        open={wipe.wipeOpen}
        target={wipe.wipeTarget}
        preview={wipe.wipePreview}
        loading={wipe.wipeLoading}
        wiping={wipe.wiping}
        onClose={wipe.close}
        onConfirm={wipe.confirmWipe}
      />
    </div>
  );
}
