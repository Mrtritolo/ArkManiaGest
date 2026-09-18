/**
 * RoleMappingSection -- "whoever has Discord role X gets ARK permission
 * group Y". Every cell saves on change (there is no Save button for these
 * rows), so each control shows its own pending state.
 */
import { useState } from "react";
import { ArrowDownUp, Link as LinkIcon, Plus, RotateCw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  IconButton,
  Input,
  Select,
  Spinner,
  Switch,
  Table,
  TableMessageRow,
} from "../../../../components/ui";
import type { RoleMapping } from "../../../../services/api";
import { useRoleMappings } from "../hooks/useRoleMappings";
import styles from "../SettingsTab.module.css";

export function RoleMappingSection() {
  const { t } = useTranslation();
  const rm = useRoleMappings();
  // New-row draft (kept local so typing doesn't yet hit the backend).
  const [draftRole, setDraftRole] = useState("");
  const [draftGroup, setDraftGroup] = useState("");

  const assignableRoles = rm.roles.filter((r) => r.name !== "@everyone" && !r.managed);
  const activeCount = rm.mappings?.filter((m) => m.is_active).length ?? 0;

  function roleLabel(mapping: RoleMapping): string {
    const guildRole = rm.roles.find((r) => r.id === mapping.discord_role_id);
    return (
      guildRole?.name ||
      mapping.discord_role_name ||
      t("discord.roleMap.unknownRole", { id: mapping.discord_role_id })
    );
  }

  async function addMapping(): Promise<void> {
    // The draft is cleared only after the row exists server side.
    if (await rm.createMapping(draftRole, draftGroup)) {
      setDraftRole("");
      setDraftGroup("");
    }
  }

  return (
    <Card
      title={t("discord.roleMap.title")}
      icon={LinkIcon}
      actions={
        <Button
          size="sm"
          icon={ArrowDownUp}
          loading={rm.syncing}
          loadingLabel={t("discord.roleMap.syncing")}
          disabled={activeCount === 0}
          title={activeCount === 0 ? t("discord.roleMap.syncDisabled") : undefined}
          onClick={() => void rm.runSync()}
        >
          {t("discord.roleMap.sync")}
        </Button>
      }
      footer={
        <div className="l-cluster">
          <Select
            size="sm"
            aria-label={t("discord.roleMap.pickRole")}
            value={draftRole}
            onChange={(event) => setDraftRole(event.target.value)}
          >
            <option value="">
              {rm.roles.length === 0 ? t("discord.roleMap.noRolesLoaded") : t("discord.roleMap.pickRole")}
            </option>
            {assignableRoles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
          <Input
            size="sm"
            mono
            aria-label={t("discord.roleMap.groupPlaceholder")}
            placeholder={t("discord.roleMap.groupPlaceholder")}
            value={draftGroup}
            onChange={(event) => setDraftGroup(event.target.value)}
          />
          <Button
            size="sm"
            variant="primary"
            icon={Plus}
            loading={rm.creating}
            loadingLabel={t("discord.roleMap.adding")}
            disabled={!draftRole || !draftGroup.trim()}
            onClick={() => void addMapping()}
          >
            {t("discord.roleMap.add")}
          </Button>
        </div>
      }
    >
      <div className="l-stack">
        <p className="u-secondary u-text-sm">{t("discord.roleMap.explain")}</p>

        {rm.error && (
          <Alert
            tone="danger"
            title={t("discord.roleMap.errors.load")}
            actions={
              <Button size="sm" icon={RotateCw} onClick={() => void rm.load()}>
                {t("common.retry")}
              </Button>
            }
          >
            {rm.error}
          </Alert>
        )}

        <Table label={t("discord.roleMap.title")} minWidth={560}>
          <thead>
            <tr>
              <th scope="col">{t("discord.roleMap.col.role")}</th>
              <th scope="col">{t("discord.roleMap.col.group")}</th>
              <th scope="col">{t("discord.roleMap.enabled")}</th>
              <th scope="col">
                <span className="u-sr-only">{t("discord.roleMap.col.actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rm.loading ? (
              <TableMessageRow colSpan={4}>
                <Spinner block label={t("common.loading")} />
              </TableMessageRow>
            ) : !rm.mappings || rm.mappings.length === 0 ? (
              <TableMessageRow colSpan={4}>
                <EmptyState icon={LinkIcon} title={t("discord.roleMap.empty")} />
              </TableMessageRow>
            ) : (
              rm.mappings.map((m) => {
                const label = roleLabel(m);
                return (
                  <tr key={m.id}>
                    <td>{label}</td>
                    <td>
                      <div className={styles.groupCell}>
                        {/* Uncontrolled: `m.ark_group_name` stays the saved value, so
                            blur can tell an edit apart.  The key remounts the input
                            whenever the saved value changes. */}
                        <Input
                          key={m.ark_group_name}
                          size="sm"
                          mono
                          aria-label={t("discord.roleMap.groupFor", { role: label })}
                          defaultValue={m.ark_group_name}
                          onBlur={(event) => {
                            const input = event.currentTarget;
                            const v = input.value.trim();
                            if (!v || v === m.ark_group_name) {
                              input.value = m.ark_group_name;
                              return;
                            }
                            void rm.patch(m.id, "group", { ark_group_name: v }).then((ok) => {
                              if (!ok) input.value = m.ark_group_name;
                            });
                          }}
                        />
                        {rm.isSaving(`${m.id}:group`) && <Spinner />}
                      </div>
                    </td>
                    <td>
                      <Switch
                        hideLabel
                        label={t("discord.roleMap.enabledFor", { role: label })}
                        checked={m.is_active}
                        disabled={rm.isSaving(`${m.id}:active`)}
                        onChange={(checked) => void rm.patch(m.id, "active", { is_active: checked })}
                      />
                    </td>
                    <td>
                      <div className="ui-row-actions">
                        <IconButton
                          size="sm"
                          tone="danger"
                          icon={Trash2}
                          label={t("discord.roleMap.deleteFor", { role: label })}
                          onClick={() => void rm.del(m, label)}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </Table>

        {rm.syncReport && (
          <p className="u-secondary u-text-sm">
            {t("discord.roleMap.lastRun", {
              s: rm.syncReport.duration_seconds.toFixed(1),
              n: rm.syncReport.linked_total,
              c: rm.syncReport.players_changed,
              e: rm.syncReport.error_count,
            })}
          </p>
        )}

        {rm.syncReport && rm.syncReport.actions.length > 0 && (
          <details className="ui-details">
            <summary>{t("discord.roleMap.details", { n: rm.syncReport.actions.length })}</summary>
            <ul className={`ui-details__body ${styles.actionList}`}>
              {rm.syncReport.actions.map((a, i) => (
                <li key={`${a.eos_id}-${i}`} className={styles.actionRow} data-error={a.error || undefined}>
                  <span className="u-truncate">
                    {a.player_name || t("discord.common.eosShort", { id: a.eos_id.slice(0, 8) })}
                  </span>
                  {a.groups_added.length > 0 && (
                    <span className={styles.added}>+{a.groups_added.join(",")}</span>
                  )}
                  {a.groups_removed.length > 0 && (
                    <span className={styles.removed}>-{a.groups_removed.join(",")}</span>
                  )}
                  {a.detail && <span className="u-muted u-push u-truncate">{a.detail}</span>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Card>
  );
}
