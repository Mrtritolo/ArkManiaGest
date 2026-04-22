/**
 * ServerInstancesPage.tsx — ARK server instance management.
 *
 * Lists Docker-hosted ARK: Survival Ascended containers (one row per
 * ``ARKM_server_instances`` record), grouped/filterable by SSH machine.
 * Operators can run lifecycle actions (start / stop / restart / update /
 * backup / status probe), admins can delete records.  Creation opens a
 * modal form; the action log for a given instance is shown in an
 * expandable drawer below the row.
 *
 * This page intentionally does NOT cover:
 *   * creating the machine itself  -> Settings -> SSH Machines
 *   * editing game config files    -> Game Config page
 *   * the global action log        -> Event Log / Instance Actions (Fase D)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Play,
  Square,
  RotateCw,
  Download,
  Activity,
  Pencil,
  Trash2,
  Plus,
  ChevronDown,
  ChevronRight,
  Server,
} from "lucide-react";

import { serverInstancesApi, machinesApi } from "../services/api";
import type {
  AuthUser,
  InstanceAction,
  InstanceActionResult,
  InstanceStatus,
  ServerInstance,
  ServerInstanceCreate,
  ServerInstanceUpdate,
  SSHMachine,
  UpdateCoordinationRole,
} from "../types";

// ---------------------------------------------------------------------------
// Props + local types
// ---------------------------------------------------------------------------

interface Props {
  /** Passed in from App.tsx so we can gate the Delete button for non-admins. */
  currentUser?: AuthUser | null;
}

/** Create form default values. */
const emptyForm: ServerInstanceCreate = {
  machine_id: 0,
  name: "",
  display_name: "",
  description: "",
  map_name: "TheIsland_WP",
  session_name: "",
  max_players: 70,
  cluster_id: "",
  mods: "",
  passive_mods: "",
  custom_args: "",
  admin_password: "",
  server_password: "",
  game_port: 7777,
  rcon_port: 27020,
  image: "acekorneya/asa_server:2_1_latest",
  mem_limit_mb: 16384,
  timezone: "Europe/Rome",
  mod_api: false,
  battleye: false,
  update_server: true,
  update_coordination_role: "FOLLOWER",
  update_coordination_priority: 1,
  cpu_optimization: false,
  pok_base_dir: "",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ServerInstancesPage({ currentUser }: Props) {
  const { t } = useTranslation();
  const isAdmin = currentUser?.role === "admin";

  const [instances, setInstances] = useState<ServerInstance[]>([]);
  const [machines, setMachines] = useState<SSHMachine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Filter
  const [filterMachineId, setFilterMachineId] = useState<number | "all">("all");

  // Per-row action state (loading button, expanded log drawer)
  const [busyId, setBusyId] = useState<{ id: number; action: string } | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [actionLog, setActionLog] = useState<Record<number, InstanceAction[]>>({});

  // Create / edit modal
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ServerInstanceCreate>({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  // -------------------------------------------------------------------------
  // Loaders
  // -------------------------------------------------------------------------

  const loadInstances = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params =
        filterMachineId === "all" ? undefined : { machine_id: filterMachineId };
      const res = await serverInstancesApi.list(params);
      setInstances(res.data);
    } catch {
      setError(t("instances.errors.load"));
    } finally {
      setLoading(false);
    }
  }, [filterMachineId, t]);

  useEffect(() => {
    machinesApi
      .list(true)
      .then((r) => setMachines(r.data))
      .catch(() => {
        /* non-fatal — the list just won't filter */
      });
  }, []);

  useEffect(() => {
    loadInstances();
  }, [loadInstances]);

  useEffect(() => {
    if (!success) return;
    const tm = setTimeout(() => setSuccess(""), 4000);
    return () => clearTimeout(tm);
  }, [success]);

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  const machineName = useCallback(
    (id: number) => machines.find((m) => m.id === id)?.name ?? `#${id}`,
    [machines],
  );

  function showActionFeedback(result: InstanceActionResult) {
    if (result.status === "success") {
      setSuccess(`OK (rc=${result.exit_code}, ${result.duration_ms} ms)`);
    } else {
      setError(
        `rc=${result.exit_code}: ${(
          result.stderr_tail ||
          result.stdout_tail ||
          t("instances.errors.action")
        )
          .split("\n")
          .slice(-5)
          .join(" | ")}`,
      );
    }
  }

  async function refreshOne(id: number) {
    try {
      const res = await serverInstancesApi.get(id);
      setInstances((prev) => prev.map((i) => (i.id === id ? res.data : i)));
    } catch {
      /* fall back to full reload on next tick */
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle action dispatcher
  // -------------------------------------------------------------------------

  type LifecycleAction =
    | "start"
    | "stop"
    | "restart"
    | "update"
    | "backup"
    | "probe";

  async function runAction(id: number, action: LifecycleAction) {
    setBusyId({ id, action });
    setError("");
    setSuccess("");
    try {
      const call =
        action === "start"   ? serverInstancesApi.start(id) :
        action === "stop"    ? serverInstancesApi.stop(id) :
        action === "restart" ? serverInstancesApi.restart(id) :
        action === "update"  ? serverInstancesApi.update_(id) :
        action === "backup"  ? serverInstancesApi.backup(id) :
                               serverInstancesApi.status(id);
      const res = await call;
      showActionFeedback(res.data);
      await refreshOne(id);
      // If the drawer is already open, reload the log too.
      if (expandedId === id) await loadActionLog(id);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : t("instances.errors.action"),
      );
    } finally {
      setBusyId(null);
    }
  }

  // -------------------------------------------------------------------------
  // Action log drawer
  // -------------------------------------------------------------------------

  async function loadActionLog(id: number) {
    try {
      const res = await serverInstancesApi.actions(id, { limit: 20 });
      setActionLog((prev) => ({ ...prev, [id]: res.data }));
    } catch {
      setActionLog((prev) => ({ ...prev, [id]: [] }));
    }
  }

  async function toggleExpanded(id: number) {
    if (expandedId === id) {
      setExpandedId(null);
    } else {
      setExpandedId(id);
      if (!actionLog[id]) await loadActionLog(id);
    }
  }

  // -------------------------------------------------------------------------
  // Create / edit
  // -------------------------------------------------------------------------

  function openCreate() {
    setEditingId(null);
    setForm({
      ...emptyForm,
      machine_id: machines[0]?.id ?? 0,
    });
    setShowForm(true);
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  function openEdit(inst: ServerInstance) {
    setEditingId(inst.id);
    setForm({
      machine_id: inst.machine_id,
      name: inst.name,
      display_name: inst.display_name,
      description: inst.description ?? "",
      map_name: inst.map_name,
      session_name: inst.session_name,
      max_players: inst.max_players,
      cluster_id: inst.cluster_id ?? "",
      mods: inst.mods ?? "",
      passive_mods: inst.passive_mods ?? "",
      custom_args: inst.custom_args ?? "",
      admin_password: "",            // never returned — blank = keep
      server_password: "",
      game_port: inst.game_port,
      rcon_port: inst.rcon_port,
      image: inst.image,
      mem_limit_mb: inst.mem_limit_mb,
      timezone: inst.timezone,
      mod_api: inst.mod_api,
      battleye: inst.battleye,
      update_server: inst.update_server,
      update_coordination_role: inst.update_coordination_role,
      update_coordination_priority: inst.update_coordination_priority,
      cpu_optimization: inst.cpu_optimization,
      pok_base_dir: inst.pok_base_dir,
    });
    setShowForm(true);
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm({ ...emptyForm });
  }

  function updateField<K extends keyof ServerInstanceCreate>(
    key: K,
    value: ServerInstanceCreate[K],
  ): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submitForm(evt: React.FormEvent) {
    evt.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (editingId === null) {
        // Create path — the form's admin_password is required.
        await serverInstancesApi.create(form);
        setSuccess(t("instances.form.save"));
      } else {
        // Update path — strip empty passwords so they're not overwritten,
        // and omit machine_id / name (immutable via PUT).
        const payload: ServerInstanceUpdate = {
          display_name: form.display_name,
          description: form.description,
          map_name: form.map_name,
          session_name: form.session_name,
          max_players: form.max_players,
          cluster_id: form.cluster_id,
          mods: form.mods,
          passive_mods: form.passive_mods,
          custom_args: form.custom_args,
          game_port: form.game_port,
          rcon_port: form.rcon_port,
          image: form.image,
          mem_limit_mb: form.mem_limit_mb,
          timezone: form.timezone,
          mod_api: form.mod_api,
          battleye: form.battleye,
          update_server: form.update_server,
          update_coordination_role: form.update_coordination_role,
          update_coordination_priority: form.update_coordination_priority,
          cpu_optimization: form.cpu_optimization,
        };
        if (form.admin_password) payload.admin_password = form.admin_password;
        if (form.server_password) payload.server_password = form.server_password;
        await serverInstancesApi.update(editingId, payload);
        setSuccess(t("instances.form.save"));
      }
      await loadInstances();
      closeForm();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t(editingId === null ? "instances.errors.create" : "instances.errors.update"),
      );
    } finally {
      setSaving(false);
    }
  }

  // -------------------------------------------------------------------------
  // Delete
  // -------------------------------------------------------------------------

  async function handleDelete(inst: ServerInstance) {
    if (!window.confirm(t("instances.confirmDelete", { name: inst.name }))) return;
    const purge = window.confirm(t("instances.confirmDeleteWithPurge"));
    setError("");
    try {
      await serverInstancesApi.delete(inst.id, purge);
      await loadInstances();
      setSuccess("OK");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("instances.errors.delete"));
    }
  }

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------

  const statusPill = useMemo(
    () => (status: InstanceStatus) => {
      const colorMap: Record<InstanceStatus, string> = {
        created:  "var(--text-muted)",
        starting: "var(--accent-warning, #f59e0b)",
        running:  "var(--accent-success, #10b981)",
        stopping: "var(--accent-warning, #f59e0b)",
        stopped:  "var(--text-muted)",
        updating: "var(--accent, #3b82f6)",
        error:    "var(--accent-danger, #ef4444)",
      };
      return (
        <span
          style={{
            display: "inline-block",
            padding: "0.15rem 0.6rem",
            borderRadius: "999px",
            background: "color-mix(in srgb, var(--bg-elevated) 60%, transparent)",
            color: colorMap[status],
            fontSize: "0.78rem",
            fontWeight: 600,
            border: `1px solid ${colorMap[status]}`,
          }}
        >
          {t(`instances.status.${status}`)}
        </span>
      );
    },
    [t],
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title">
            <Server size={22} style={{ verticalAlign: "-4px", marginRight: "0.5rem" }} />
            {t("instances.title")}
          </h1>
          <p className="page-subtitle">{t("instances.subtitle")}</p>
        </div>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <span style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
              {t("instances.filterMachine")}
            </span>
            <select
              value={filterMachineId}
              onChange={(e) =>
                setFilterMachineId(
                  e.target.value === "all" ? "all" : Number(e.target.value),
                )
              }
            >
              <option value="all">{t("instances.filterAll")}</option>
              {machines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn-primary"
            onClick={openCreate}
            disabled={machines.length === 0}
          >
            <Plus size={15} style={{ verticalAlign: "-3px" }} /> {t("instances.newButton")}
          </button>
        </div>
      </header>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {loading ? (
        <p style={{ color: "var(--text-muted)" }}>{t("instances.loading")}</p>
      ) : instances.length === 0 ? (
        <p style={{ color: "var(--text-muted)" }}>{t("instances.noInstances")}</p>
      ) : (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: "2rem" }}></th>
                <th>{t("instances.columns.name")}</th>
                <th>{t("instances.columns.machine")}</th>
                <th>{t("instances.columns.map")}</th>
                <th>{t("instances.columns.status")}</th>
                <th>{t("instances.columns.ports")}</th>
                <th>{t("instances.columns.cluster")}</th>
                <th style={{ textAlign: "right" }}>
                  {t("instances.columns.actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {instances.map((inst) => (
                <>
                  <tr key={inst.id}>
                    <td>
                      <button
                        className="btn-ghost"
                        onClick={() => toggleExpanded(inst.id)}
                        title={t("instances.actions.viewLog")}
                      >
                        {expandedId === inst.id ? (
                          <ChevronDown size={15} />
                        ) : (
                          <ChevronRight size={15} />
                        )}
                      </button>
                    </td>
                    <td>
                      <strong>{inst.display_name || inst.name}</strong>
                      <br />
                      <small style={{ color: "var(--text-muted)" }}>
                        {inst.name}
                      </small>
                    </td>
                    <td>{machineName(inst.machine_id)}</td>
                    <td>
                      {inst.map_name}
                      <br />
                      <small style={{ color: "var(--text-muted)" }}>
                        {inst.max_players} slots
                      </small>
                    </td>
                    <td>{statusPill(inst.status)}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.82rem" }}>
                      {inst.game_port}
                      <br />
                      <small style={{ color: "var(--text-muted)" }}>
                        rcon {inst.rcon_port}
                      </small>
                    </td>
                    <td>{inst.cluster_id || "—"}</td>
                    <td style={{ textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: "0.3rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
                        <ActionBtn
                          icon={<Play size={14} />}
                          label={t("instances.actions.start")}
                          onClick={() => runAction(inst.id, "start")}
                          busy={busyId?.id === inst.id && busyId?.action === "start"}
                          disabled={!!busyId}
                        />
                        <ActionBtn
                          icon={<Square size={14} />}
                          label={t("instances.actions.stop")}
                          onClick={() => runAction(inst.id, "stop")}
                          busy={busyId?.id === inst.id && busyId?.action === "stop"}
                          disabled={!!busyId}
                        />
                        <ActionBtn
                          icon={<RotateCw size={14} />}
                          label={t("instances.actions.restart")}
                          onClick={() => runAction(inst.id, "restart")}
                          busy={busyId?.id === inst.id && busyId?.action === "restart"}
                          disabled={!!busyId}
                        />
                        <ActionBtn
                          icon={<Activity size={14} />}
                          label={t("instances.actions.probe")}
                          onClick={() => runAction(inst.id, "probe")}
                          busy={busyId?.id === inst.id && busyId?.action === "probe"}
                          disabled={!!busyId}
                        />
                        <ActionBtn
                          icon={<Download size={14} />}
                          label={t("instances.actions.backup")}
                          onClick={() => runAction(inst.id, "backup")}
                          busy={busyId?.id === inst.id && busyId?.action === "backup"}
                          disabled={!!busyId}
                        />
                        <button
                          className="btn-ghost"
                          onClick={() => openEdit(inst)}
                          title={t("instances.actions.edit")}
                        >
                          <Pencil size={14} />
                        </button>
                        {isAdmin && (
                          <button
                            className="btn-ghost"
                            onClick={() => handleDelete(inst)}
                            title={t("instances.actions.delete")}
                            style={{ color: "var(--accent-danger, #ef4444)" }}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {expandedId === inst.id && (
                    <tr key={`${inst.id}-log`}>
                      <td colSpan={8} style={{ background: "var(--bg-subtle)" }}>
                        <ActionLogPanel
                          instanceName={inst.display_name || inst.name}
                          actions={actionLog[inst.id]}
                        />
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div ref={formRef} className="card" style={{ marginTop: "1.5rem" }}>
          <h2 style={{ marginTop: 0 }}>
            {editingId === null
              ? t("instances.form.newTitle")
              : t("instances.form.editTitle")}
          </h2>
          <form onSubmit={submitForm}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: "1rem",
              }}
            >
              <Field label={t("instances.form.machine")}>
                <select
                  value={form.machine_id || ""}
                  onChange={(e) =>
                    updateField("machine_id", Number(e.target.value))
                  }
                  disabled={editingId !== null}
                  required
                >
                  <option value="" disabled>
                    —
                  </option>
                  {machines.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field
                label={t("instances.form.name")}
                hint={t("instances.form.nameHint")}
              >
                <input
                  value={form.name}
                  onChange={(e) => updateField("name", e.target.value)}
                  pattern="[a-zA-Z0-9][a-zA-Z0-9_\-]*"
                  disabled={editingId !== null}
                  required
                />
              </Field>

              <Field label={t("instances.form.displayName")}>
                <input
                  value={form.display_name ?? ""}
                  onChange={(e) => updateField("display_name", e.target.value)}
                />
              </Field>

              <Field label={t("instances.form.description")}>
                <input
                  value={form.description ?? ""}
                  onChange={(e) => updateField("description", e.target.value)}
                />
              </Field>

              <Field label={t("instances.form.map")}>
                <input
                  value={form.map_name ?? ""}
                  onChange={(e) => updateField("map_name", e.target.value)}
                  required
                />
              </Field>

              <Field label={t("instances.form.sessionName")}>
                <input
                  value={form.session_name ?? ""}
                  onChange={(e) => updateField("session_name", e.target.value)}
                />
              </Field>

              <Field label={t("instances.form.maxPlayers")}>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={form.max_players ?? 70}
                  onChange={(e) =>
                    updateField("max_players", Number(e.target.value))
                  }
                />
              </Field>

              <Field label={t("instances.form.cluster")}>
                <input
                  value={form.cluster_id ?? ""}
                  onChange={(e) => updateField("cluster_id", e.target.value)}
                />
              </Field>

              <Field label={t("instances.form.gamePort")}>
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={form.game_port ?? 7777}
                  onChange={(e) =>
                    updateField("game_port", Number(e.target.value))
                  }
                />
              </Field>

              <Field label={t("instances.form.rconPort")}>
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={form.rcon_port ?? 27020}
                  onChange={(e) =>
                    updateField("rcon_port", Number(e.target.value))
                  }
                />
              </Field>

              <Field
                label={t("instances.form.adminPassword")}
                hint={
                  editingId !== null
                    ? t("instances.form.adminPasswordEditHint")
                    : undefined
                }
              >
                <input
                  type="password"
                  value={form.admin_password}
                  onChange={(e) =>
                    updateField("admin_password", e.target.value)
                  }
                  minLength={editingId === null ? 4 : 0}
                  required={editingId === null}
                />
              </Field>

              <Field label={t("instances.form.serverPassword")}>
                <input
                  type="password"
                  value={form.server_password ?? ""}
                  onChange={(e) =>
                    updateField("server_password", e.target.value)
                  }
                />
              </Field>

              <Field label={t("instances.form.image")}>
                <input
                  value={form.image ?? ""}
                  onChange={(e) => updateField("image", e.target.value)}
                />
              </Field>

              <Field label={t("instances.form.memLimit")}>
                <input
                  type="number"
                  min={1024}
                  max={131072}
                  value={form.mem_limit_mb ?? 16384}
                  onChange={(e) =>
                    updateField("mem_limit_mb", Number(e.target.value))
                  }
                />
              </Field>

              <Field label={t("instances.form.timezone")}>
                <input
                  value={form.timezone ?? ""}
                  onChange={(e) => updateField("timezone", e.target.value)}
                />
              </Field>

              <Field label={t("instances.form.updateRole")}>
                <select
                  value={form.update_coordination_role ?? "FOLLOWER"}
                  onChange={(e) =>
                    updateField(
                      "update_coordination_role",
                      e.target.value as UpdateCoordinationRole,
                    )
                  }
                >
                  <option value="FOLLOWER">FOLLOWER</option>
                  <option value="MASTER">MASTER</option>
                </select>
              </Field>

              <Field label={t("instances.form.updatePriority")}>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={form.update_coordination_priority ?? 1}
                  onChange={(e) =>
                    updateField(
                      "update_coordination_priority",
                      Number(e.target.value),
                    )
                  }
                />
              </Field>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: "1rem",
                marginTop: "1rem",
              }}
            >
              <Field label={t("instances.form.mods")}>
                <input
                  value={form.mods ?? ""}
                  onChange={(e) => updateField("mods", e.target.value)}
                />
              </Field>
              <Field label={t("instances.form.passiveMods")}>
                <input
                  value={form.passive_mods ?? ""}
                  onChange={(e) => updateField("passive_mods", e.target.value)}
                />
              </Field>
              <Field label={t("instances.form.customArgs")}>
                <input
                  value={form.custom_args ?? ""}
                  onChange={(e) => updateField("custom_args", e.target.value)}
                />
              </Field>
              <Field label={t("instances.form.pokBaseDir")}>
                <input
                  value={form.pok_base_dir ?? ""}
                  onChange={(e) => updateField("pok_base_dir", e.target.value)}
                />
              </Field>
            </div>

            <fieldset
              style={{
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm, 4px)",
                padding: "0.75rem 1rem",
                margin: "1rem 0",
              }}
            >
              <legend style={{ padding: "0 0.4rem", fontSize: "0.82rem" }}>
                {t("instances.form.flags")}
              </legend>
              <div style={{ display: "flex", gap: "1.2rem", flexWrap: "wrap" }}>
                <Checkbox
                  label={t("instances.form.modApi")}
                  checked={!!form.mod_api}
                  onChange={(v) => updateField("mod_api", v)}
                />
                <Checkbox
                  label={t("instances.form.battleye")}
                  checked={!!form.battleye}
                  onChange={(v) => updateField("battleye", v)}
                />
                <Checkbox
                  label={t("instances.form.updateServer")}
                  checked={!!form.update_server}
                  onChange={(v) => updateField("update_server", v)}
                />
                <Checkbox
                  label={t("instances.form.cpuOptimization")}
                  checked={!!form.cpu_optimization}
                  onChange={(v) => updateField("cpu_optimization", v)}
                />
              </div>
            </fieldset>

            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
              <button
                type="submit"
                className="btn-primary"
                disabled={saving || !form.machine_id}
              >
                {saving ? t("instances.form.saving") : t("instances.form.save")}
              </button>
              <button type="button" className="btn-secondary" onClick={closeForm}>
                {t("instances.form.cancel")}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small presentational helpers (local to this file on purpose)
// ---------------------------------------------------------------------------

function Field(props: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
      <span style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
        {props.label}
      </span>
      {props.children}
      {props.hint && (
        <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
          {props.hint}
        </span>
      )}
    </label>
  );
}

function Checkbox(props: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span style={{ fontSize: "0.85rem" }}>{props.label}</span>
    </label>
  );
}

function ActionBtn(props: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  busy: boolean;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  return (
    <button
      className="btn-ghost"
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.label}
      style={{ opacity: props.busy ? 0.5 : 1 }}
    >
      {props.busy ? <small>{t("instances.actions.running")}</small> : props.icon}
    </button>
  );
}

function ActionLogPanel(props: {
  instanceName: string;
  actions: InstanceAction[] | undefined;
}) {
  const { t } = useTranslation();
  const rows = props.actions;
  return (
    <div style={{ padding: "0.75rem 1rem" }}>
      <h4 style={{ marginTop: 0 }}>
        {t("instances.log.title", { name: props.instanceName })}
      </h4>
      {!rows ? (
        <p style={{ color: "var(--text-muted)" }}>…</p>
      ) : rows.length === 0 ? (
        <p style={{ color: "var(--text-muted)" }}>{t("instances.log.empty")}</p>
      ) : (
        <div style={{ display: "grid", gap: "0.5rem" }}>
          {rows.map((a) => (
            <details
              key={a.id}
              style={{
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm, 4px)",
                padding: "0.4rem 0.7rem",
                background: "var(--bg-surface)",
              }}
            >
              <summary
                style={{
                  cursor: "pointer",
                  display: "flex",
                  gap: "1rem",
                  fontSize: "0.85rem",
                  flexWrap: "wrap",
                }}
              >
                <span style={{ fontWeight: 600 }}>{a.action}</span>
                <span
                  style={{
                    color:
                      a.status === "success"
                        ? "var(--accent-success, #10b981)"
                        : a.status === "failed"
                        ? "var(--accent-danger, #ef4444)"
                        : "var(--text-muted)",
                  }}
                >
                  {a.status}
                </span>
                <span style={{ color: "var(--text-muted)" }}>
                  {t("instances.log.exitCode")} {a.exit_code ?? "—"}
                </span>
                <span style={{ color: "var(--text-muted)" }}>
                  {a.duration_ms ?? "—"} ms
                </span>
                <span style={{ color: "var(--text-muted)" }}>
                  {a.started_at ?? ""}
                </span>
                <span style={{ color: "var(--text-muted)" }}>
                  {a.username ? `@${a.username}` : ""}
                </span>
              </summary>
              <pre
                style={{
                  margin: "0.5rem 0 0",
                  padding: "0.5rem",
                  background: "var(--bg-code, rgba(0,0,0,0.2))",
                  borderRadius: "var(--radius-sm, 4px)",
                  maxHeight: "240px",
                  overflow: "auto",
                  fontSize: "0.78rem",
                }}
              >
                {a.stdout || a.stderr || t("instances.log.noStdout")}
              </pre>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
