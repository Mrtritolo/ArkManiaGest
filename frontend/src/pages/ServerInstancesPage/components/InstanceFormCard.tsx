/** Create / edit form for one ARK server instance (a card, not a dialog). */
import type { FormEvent, RefObject } from "react";
import { Pencil, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Alert, Button, Card, Checkbox, Field, Input, Select } from "../../../components/ui";
import type { ServerInstance, ServerInstanceCreate, SSHMachine, UpdateCoordinationRole } from "../../../types";
import type { QuotedField } from "../instanceModel";

interface Props {
  editingId: number | null;
  editingInstance?: ServerInstance;
  form: ServerInstanceCreate;
  setField: <K extends keyof ServerInstanceCreate>(key: K, value: ServerInstanceCreate[K]) => void;
  machines: SSHMachine[];
  saving: boolean;
  formError: string;
  invalidFields: QuotedField[];
  clearServerPassword: boolean;
  setClearServerPassword: (value: boolean) => void;
  cardRef: RefObject<HTMLDivElement>;
  firstFieldRef: RefObject<HTMLInputElement>;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
}

export function InstanceFormCard({
  editingId,
  editingInstance,
  form,
  setField,
  machines,
  saving,
  formError,
  invalidFields,
  clearServerPassword,
  setClearServerPassword,
  cardRef,
  firstFieldRef,
  onSubmit,
  onCancel,
}: Props) {
  const { t } = useTranslation();
  const isEdit = editingId !== null;
  const quoteError = (field: QuotedField) =>
    invalidFields.includes(field) ? t("instances.form.noDoubleQuote") : undefined;

  return (
    <div ref={cardRef}>
      <Card
        title={isEdit ? t("instances.form.editTitle") : t("instances.form.newTitle")}
        icon={isEdit ? Pencil : Plus}
      >
        <form className="l-stack" onSubmit={onSubmit}>
          {formError && <Alert tone="danger">{formError}</Alert>}

          <div className="l-grid--form">
            <Field label={t("instances.form.machine")} required>
              <Select
                value={form.machine_id || ""}
                onChange={e => setField("machine_id", Number(e.target.value))}
                disabled={isEdit}
                required
              >
                <option value="" disabled>
                  {t("instances.form.machinePlaceholder")}
                </option>
                {machines.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t("instances.form.name")} hint={t("instances.form.nameHint")} required>
              <Input
                ref={isEdit ? undefined : firstFieldRef}
                value={form.name}
                onChange={e => setField("name", e.target.value)}
                pattern="[a-zA-Z0-9][a-zA-Z0-9_\-]*"
                disabled={isEdit}
                required
              />
            </Field>

            <Field label={t("instances.form.displayName")}>
              <Input
                ref={isEdit ? firstFieldRef : undefined}
                value={form.display_name ?? ""}
                onChange={e => setField("display_name", e.target.value)}
              />
            </Field>

            <Field label={t("instances.form.description")} className="u-span-full">
              <Input
                value={form.description ?? ""}
                onChange={e => setField("description", e.target.value)}
              />
            </Field>

            <Field label={t("instances.form.map")} error={quoteError("map_name")} required>
              <Input
                value={form.map_name ?? ""}
                onChange={e => setField("map_name", e.target.value)}
                required
              />
            </Field>

            <Field label={t("instances.form.sessionName")} error={quoteError("session_name")}>
              <Input
                value={form.session_name ?? ""}
                onChange={e => setField("session_name", e.target.value)}
              />
            </Field>

            <Field label={t("instances.form.maxPlayers")}>
              <Input
                type="number"
                min={1}
                max={500}
                value={form.max_players ?? 70}
                onChange={e => setField("max_players", Number(e.target.value))}
              />
            </Field>

            <Field label={t("instances.form.cluster")}>
              <Input
                value={form.cluster_id ?? ""}
                onChange={e => setField("cluster_id", e.target.value)}
              />
            </Field>

            <Field label={t("instances.form.gamePort")}>
              <Input
                type="number"
                min={1}
                max={65535}
                value={form.game_port ?? 7777}
                onChange={e => setField("game_port", Number(e.target.value))}
              />
            </Field>

            <Field label={t("instances.form.rconPort")}>
              <Input
                type="number"
                min={1}
                max={65535}
                value={form.rcon_port ?? 27020}
                onChange={e => setField("rcon_port", Number(e.target.value))}
              />
            </Field>

            <Field
              label={t("instances.form.adminPassword")}
              hint={isEdit ? t("instances.form.adminPasswordEditHint") : undefined}
              error={quoteError("admin_password")}
              required={!isEdit}
            >
              <Input
                type="password"
                revealable
                autoComplete="new-password"
                value={form.admin_password}
                onChange={e => setField("admin_password", e.target.value)}
                minLength={isEdit ? 0 : 4}
                required={!isEdit}
              />
            </Field>

            <Field label={t("instances.form.serverPassword")} error={quoteError("server_password")}>
              <Input
                type="password"
                revealable
                autoComplete="new-password"
                value={form.server_password ?? ""}
                onChange={e => setField("server_password", e.target.value)}
                disabled={clearServerPassword}
              />
            </Field>

            {/* A blank field keeps the stored password, so removing it needs
                its own explicit control. */}
            {editingInstance?.has_server_password && (
              <Checkbox
                className="u-span-full"
                label={t("instances.form.clearServerPassword")}
                checked={clearServerPassword}
                onChange={e => setClearServerPassword(e.target.checked)}
              />
            )}

            <Field label={t("instances.form.image")}>
              <Input mono value={form.image ?? ""} onChange={e => setField("image", e.target.value)} />
            </Field>

            <Field label={t("instances.form.memLimit")}>
              <Input
                type="number"
                min={1024}
                max={131072}
                value={form.mem_limit_mb ?? 16384}
                onChange={e => setField("mem_limit_mb", Number(e.target.value))}
              />
            </Field>

            <Field label={t("instances.form.timezone")}>
              <Input value={form.timezone ?? ""} onChange={e => setField("timezone", e.target.value)} />
            </Field>

            <Field label={t("instances.form.mods")} className="u-span-full">
              <Input mono value={form.mods ?? ""} onChange={e => setField("mods", e.target.value)} />
            </Field>

            <Field label={t("instances.form.passiveMods")} className="u-span-full">
              <Input
                mono
                value={form.passive_mods ?? ""}
                onChange={e => setField("passive_mods", e.target.value)}
              />
            </Field>

            <Field label={t("instances.form.customArgs")} className="u-span-full">
              <Input
                mono
                value={form.custom_args ?? ""}
                onChange={e => setField("custom_args", e.target.value)}
              />
            </Field>

            <Field
              label={t("instances.form.pokBaseDir")}
              hint={isEdit ? t("instances.form.pokBaseDirEditHint") : undefined}
              className="u-span-full"
            >
              <Input
                mono
                value={form.pok_base_dir ?? ""}
                onChange={e => setField("pok_base_dir", e.target.value)}
                // ServerInstanceUpdate has no pok_base_dir: an edit would be dropped.
                disabled={isEdit}
              />
            </Field>

            <Field label={t("instances.form.updateRole")}>
              <Select
                value={form.update_coordination_role ?? "FOLLOWER"}
                onChange={e =>
                  setField("update_coordination_role", e.target.value as UpdateCoordinationRole)
                }
              >
                <option value="FOLLOWER">FOLLOWER</option>
                <option value="MASTER">MASTER</option>
              </Select>
            </Field>

            <Field label={t("instances.form.updatePriority")}>
              <Input
                type="number"
                min={0}
                max={100}
                value={form.update_coordination_priority ?? 1}
                onChange={e => setField("update_coordination_priority", Number(e.target.value))}
              />
            </Field>
          </div>

          <fieldset className="ui-fieldset">
            <legend>{t("instances.form.flags")}</legend>
            <div className="l-cluster">
              {(
                [
                  ["mod_api", t("instances.form.modApi")],
                  ["battleye", t("instances.form.battleye")],
                  ["update_server", t("instances.form.updateServer")],
                  ["cpu_optimization", t("instances.form.cpuOptimization")],
                ] as Array<[keyof ServerInstanceCreate, string]>
              ).map(([key, label]) => (
                <Checkbox
                  key={key as string}
                  label={label}
                  checked={!!form[key]}
                  onChange={e => setField(key, e.target.checked as never)}
                />
              ))}
            </div>
          </fieldset>

          <div className="l-cluster">
            <Button
              type="submit"
              variant="primary"
              loading={saving}
              loadingLabel={t("instances.form.saving")}
              disabled={!form.machine_id}
            >
              {t("instances.form.save")}
            </Button>
            <Button variant="ghost" onClick={onCancel}>
              {t("instances.form.cancel")}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
