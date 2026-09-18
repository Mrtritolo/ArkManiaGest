/**
 * useRoleMappings -- CRUD over arkmaniagest_discord_role_map plus the
 * Discord-role -> ARK-group reconciliation run.
 *
 * Every row edit saves immediately, so each field carries its own pending
 * key ("<id>:group", "<id>:active"): renaming a group and flipping its
 * toggle in the same breath must not cancel each other out.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  discordApi,
  type DiscordGuildRole,
  type RoleMapping,
  type RoleSyncReport,
} from "../../../../services/api";
import { extractError } from "../../../../utils/errors";
import { usePending } from "../../../../hooks/usePending";
import { useConfirm, useToast } from "../../../../components/ui";

export interface RoleMappings {
  mappings: RoleMapping[] | null;
  roles: DiscordGuildRole[];
  loading: boolean;
  /** Load failure only: action results are toasts. */
  error: string;
  creating: boolean;
  syncing: boolean;
  syncReport: RoleSyncReport | null;
  isSaving: (key: string) => boolean;
  load: () => Promise<void>;
  createMapping: (roleId: string, group: string) => Promise<boolean>;
  patch: (id: number, field: "group" | "active", body: Partial<RoleMapping>) => Promise<boolean>;
  del: (mapping: RoleMapping, label: string) => Promise<void>;
  runSync: () => Promise<void>;
}

export function useRoleMappings(): RoleMappings {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const pending = usePending<string>();

  const [mappings, setMappings] = useState<RoleMapping[] | null>(null);
  const [roles, setRoles] = useState<DiscordGuildRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncReport, setSyncReport] = useState<RoleSyncReport | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError("");
    try {
      const [m, r] = await Promise.all([
        discordApi.listRoleMappings(),
        discordApi.guildRoles().catch(() => ({ data: [] as DiscordGuildRole[] })),
      ]);
      setMappings(m.data);
      setRoles(r.data);
    } catch (err: unknown) {
      setError(extractError(err, t("discord.roleMap.errors.load")));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const createMapping = useCallback(
    async (roleId: string, group: string): Promise<boolean> => {
      const role = roleId.trim();
      const grp = group.trim();
      if (!role || !grp) {
        toast.error(t("discord.roleMap.errors.required"));
        return false;
      }
      setCreating(true);
      try {
        const guildRole = roles.find((r) => r.id === role);
        await discordApi.createRoleMapping({
          discord_role_id: role,
          discord_role_name: guildRole?.name,
          ark_group_name: grp,
          is_active: true,
        });
        await load();
        return true;
      } catch (err: unknown) {
        toast.error(extractError(err, t("discord.roleMap.errors.create")));
        return false;
      } finally {
        setCreating(false);
      }
    },
    [roles, load, toast, t],
  );

  const patch = useCallback(
    async (id: number, field: "group" | "active", body: Partial<RoleMapping>): Promise<boolean> => {
      const outcome = await pending.run(`${id}:${field}`, async () => {
        try {
          await discordApi.updateRoleMapping(id, body);
          setMappings((prev) => prev?.map((m) => (m.id === id ? { ...m, ...body } : m)) ?? null);
          return true;
        } catch (err: unknown) {
          toast.error(extractError(err, t("discord.roleMap.errors.update")));
          return false;
        }
      });
      // `undefined` means the same field was already in flight: nothing changed.
      return outcome === true;
    },
    [pending, toast, t],
  );

  const del = useCallback(
    async (mapping: RoleMapping, label: string): Promise<void> => {
      const ok = await confirm({
        title: t("discord.roleMap.confirmDeleteTitle"),
        description: t("discord.roleMap.confirmDeleteBody", {
          role: label,
          group: mapping.ark_group_name,
        }),
        confirmLabel: t("discord.roleMap.confirmDeleteConfirm"),
        tone: "danger",
      });
      if (!ok) return;
      try {
        await discordApi.deleteRoleMapping(mapping.id);
        setMappings((prev) => prev?.filter((m) => m.id !== mapping.id) ?? null);
        toast.success(t("discord.roleMap.deleted"));
      } catch (err: unknown) {
        toast.error(extractError(err, t("discord.roleMap.errors.delete")));
      }
    },
    [confirm, toast, t],
  );

  const runSync = useCallback(async (): Promise<void> => {
    const ok = await confirm({
      title: t("discord.roleMap.confirmSyncTitle"),
      description: t("discord.roleMap.confirmSyncBody"),
      confirmLabel: t("discord.roleMap.sync"),
    });
    if (!ok) return;
    setSyncing(true);
    setSyncReport(null);
    try {
      const res = await discordApi.syncRoles();
      setSyncReport(res.data);
      toast.success(
        t("discord.roleMap.lastRun", {
          s: res.data.duration_seconds.toFixed(1),
          n: res.data.linked_total,
          c: res.data.players_changed,
          e: res.data.error_count,
        }),
      );
    } catch (err: unknown) {
      toast.error(extractError(err, t("discord.roleMap.errors.sync")));
    } finally {
      setSyncing(false);
    }
  }, [confirm, toast, t]);

  return {
    mappings,
    roles,
    loading,
    error,
    creating,
    syncing,
    syncReport,
    isSaving: pending.isPending,
    load,
    createMapping,
    patch,
    del,
    runSync,
  };
}
