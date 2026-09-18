/**
 * SyncPanel — per-container ".arkprofile name sync" launcher, plus the two
 * banners the last run can leave behind (result summary, orphan profiles).
 */
import { useTranslation } from "react-i18next";
import { Download, UserCheck, X } from "lucide-react";
import type { SyncContainer, SyncNamesResponse } from "../../../services/api";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  IconButton,
  Table,
  TableMessageRow,
} from "../../../components/ui";

export interface SyncPanelProps {
  containers: SyncContainer[];
  syncing: boolean;
  onSyncAll: () => void;
  onSyncOne: (machineId: number, containerName: string) => void;
  onClose: () => void;
}

export function SyncPanel({ containers, syncing, onSyncAll, onSyncOne, onClose }: SyncPanelProps) {
  const { t } = useTranslation();
  return (
    <Card
      title={t("players.syncPanel.title")}
      icon={Download}
      flush
      className="u-span-full"
      actions={
        <>
          <Button
            size="sm"
            variant="primary"
            icon={Download}
            loading={syncing}
            loadingLabel={t("players.syncing")}
            onClick={onSyncAll}
          >
            {t("players.syncPanel.allButton")}
          </Button>
          <IconButton size="sm" icon={X} label={t("common.close")} onClick={onClose} />
        </>
      }
    >
      <Table label={t("players.syncPanel.title")} minWidth={720}>
        <thead>
          <tr>
            <th scope="col">{t("players.syncPanel.columns.container")}</th>
            <th scope="col">{t("players.syncPanel.columns.server")}</th>
            <th scope="col">{t("players.syncPanel.columns.map")}</th>
            <th scope="col">{t("players.syncPanel.columns.host")}</th>
            <th scope="col" className="u-text-end">{t("players.syncPanel.columns.profiles")}</th>
            <th scope="col" className="u-text-end">{t("players.syncPanel.columns.action")}</th>
          </tr>
        </thead>
        <tbody>
          {containers.length === 0 ? (
            <TableMessageRow colSpan={6}>
              <EmptyState icon={Download} title={t("players.syncPanel.empty")} />
            </TableMessageRow>
          ) : (
            containers.map(c => (
              <tr key={`${c.machine_id}|${c.container_name}`}>
                <td className="u-mono">{c.container_name}</td>
                <td>{c.server_name || "--"}</td>
                <td>{c.map_name || "--"}</td>
                <td className="u-mono">{c.machine_name}</td>
                <td className="u-text-end u-num">{c.profile_count || 0}</td>
                <td>
                  <div className="ui-row-actions">
                    <IconButton
                      size="sm"
                      icon={Download}
                      label={t("players.syncPanel.syncOne", { container: c.container_name })}
                      disabled={syncing}
                      onClick={() => onSyncOne(c.machine_id, c.container_name)}
                    />
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
    </Card>
  );
}

export interface SyncResultBannerProps {
  result: SyncNamesResponse;
  onDismiss: () => void;
}

export function SyncResultBanner({ result, onDismiss }: SyncResultBannerProps) {
  const { t } = useTranslation();
  return (
    <Alert
      tone={result.updated > 0 ? "success" : "warning"}
      title={t("players.syncResult.title")}
      onDismiss={onDismiss}
    >
      {[
        t("players.syncResult.scanned", { count: result.total_profiles_scanned }),
        t("players.syncResult.matched", { count: result.matched }),
        t("players.syncResult.updated", { count: result.updated }),
        ...(result.errors.length > 0 ? [t("players.syncResult.errors", { count: result.errors.length })] : []),
        ...(result.not_matched_total > 0 ? [t("players.syncResult.noMatch", { count: result.not_matched_total })] : []),
      ].join(" · ")}
    </Alert>
  );
}

export interface OrphanProfilesBannerProps {
  count: number;
  canOperate: boolean;
  onOpenImport: () => void;
  onDismiss: () => void;
}

export function OrphanProfilesBanner({ count, canOperate, onOpenImport, onDismiss }: OrphanProfilesBannerProps) {
  const { t } = useTranslation();
  return (
    <Alert
      tone="warning"
      title={t("players.importMissing.bannerTitle")}
      onDismiss={onDismiss}
      actions={
        canOperate ? (
          <Button size="sm" icon={UserCheck} onClick={onOpenImport}>
            {t("players.importMissing.openModal", { n: count })}
          </Button>
        ) : undefined
      }
    >
      {t("players.importMissing.banner", { n: count })}
    </Alert>
  );
}
