/**
 * ServerInstancesPage.tsx -- Unified ARK server management.
 *
 * Replaces the old "ARK Instances" + "Containers" duo with a single page
 * that:
 *
 *   - Lists every ``ARKM_server_instances`` row registered in the panel DB.
 *   - Lets the operator scan SSH machines for ARK containers that are NOT
 *     yet in the DB (orphans) and IMPORT them as managed instances with
 *     one click.
 *   - Surfaces the lifecycle actions (start / stop / restart / update /
 *     backup / probe / rcon) and the per-instance audit log.
 *
 * Visual style follows the design-system classes from index.css
 * (.page-header / .card / .form-grid / .badge / .machine-card etc.) so
 * fonts, spacing and colours are consistent with Machines / Players /
 * GameConfig pages.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Play,
  Square,
  RotateCw,
  Download,
  DownloadCloud,
  Activity,
  Pencil,
  Trash2,
  Plus,
  Server,
  RefreshCw,
  Search,
  PackagePlus,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

import {
  serverInstancesApi,
  machinesApi,
  containersApi,
} from "../services/api";
import type {
  AuthUser,
  DiscoveredContainer,
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
// Props + helpers
// ---------------------------------------------------------------------------

interface Props {
  /** Passed in from App.tsx so the Delete button is gated for non-admins. */
  currentUser?: AuthUser | null;
}

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

interface ImportFormState {
  display_name:    string;
  map_name:        string;
  game_port:       number;
  rcon_port:       number;
  admin_password:  string;
  server_password: string;
}

function emptyImportForm(c: DiscoveredContainer): ImportFormState {
  return {
    display_name:    c.server_name || c.name,
    map_name:        c.map_name || "TheIsland_WP",
    game_port:       7777,
    rcon_port:       27020,
    admin_password:  "",
    server_password: "",
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ServerInstancesPage({ currentUser }: Props) {
  const { t } = useTranslation();
  const isAdmin = currentUser?.role === "admin";

  const [instances, setInstances]   = useState<ServerInstance[]>([]);
  const [machines, setMachines]     = useState<SSHMachine[]>([]);
  const [discovered, setDiscovered] = useState<DiscoveredContainer[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState("");
  const [success, setSuccess]       = useState("");

  // Filter
  const [filterMachineId, setFilterMachineId] = useState<number | "all">("all");

  // Per-row action state
  const [busyId, setBusyId] = useState<{ id: number; action: string } | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [actionLog, setActionLog] = useState<Record<number, InstanceAction[]>>({});

  // Create / edit modal-as-card
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ServerInstanceCreate>({ ...emptyForm });
  const [saving, setSaving] = useState(false);

  // Scan + import-orphan flow
  const [scanningMachineId, setScanningMachineId] = useState<number | null>(null);
  const [importingFor, setImportingFor] = useState<DiscoveredContainer | null>(null);
  const [importForm, setImportForm] = useState<ImportFormState | null>(null);
  const [importing, setImporting] = useState(false);

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

  const loadMachines = useCallback(async () => {
    try {
      const r = await machinesApi.list(true);
      setMachines(r.data);
    } catch {
      /* non-fatal */
    }
  }, []);

  // Load any cached scan results so the page can render orphan rows
  // without forcing the operator to hit "Scan" first on every visit.
  const loadDiscoveredCache = useCallback(async () => {
    try {
      const res = await containersApi.getAllContainers();
      // The endpoint returns `{ containers: [...], last_scan: ... }`.
      const list = (res.data as { containers?: DiscoveredContainer[] })?.containers ?? [];
      setDiscovered(list);
    } catch {
      setDiscovered([]);
    }
  }, []);

  useEffect(() => { loadMachines(); loadDiscoveredCache(); }, [loadMachines, loadDiscoveredCache]);
  useEffect(() => { loadInstances(); }, [loadInstances]);
  useEffect(() => {
    if (!success) return;
    const tm = setTimeout(() => setSuccess(""), 4000);
    return () => clearTimeout(tm);
  }, [success]);

  // -------------------------------------------------------------------------
  // Derived data
  // -------------------------------------------------------------------------

  const machineById = useMemo(
    () => Object.fromEntries(machines.map((m) => [m.id, m])),
    [machines],
  );
  const machineName = useCallback(
    (id: number) => machineById[id]?.name ?? `#${id}`,
    [machineById],
  );

  // Container is an "orphan" if no ARKM_server_instances row uses its
  // container_name on the same machine.
  const orphans = useMemo(() => {
    const known = new Set(instances.map((i) => `${i.machine_id}:${i.container_name}`));
    return discovered.filter((c) => {
      if (filterMachineId !== "all" && c.machine_id !== filterMachineId) return false;
      return !known.has(`${c.machine_id}:${c.name}`);
    });
  }, [discovered, instances, filterMachineId]);

  // -------------------------------------------------------------------------
  // Status helpers
  // -------------------------------------------------------------------------

  const statusBadgeClass = (status: InstanceStatus): string => {
    if (status === "running") return "badge badge-md badge-online";
    if (status === "error")   return "badge badge-md badge-error";
    if (status === "stopped" || status === "created" || status === "stopping")
      return "badge badge-md badge-offline";
    if (status === "starting" || status === "updating")
      return "badge badge-md badge-testing";
    return "badge badge-md badge-unknown";
  };

  function showActionFeedback(result: InstanceActionResult) {
    if (result.status === "success") {
      setSuccess(`OK (rc=${result.exit_code}, ${result.duration_ms} ms)`);
    } else {
      setError(
        `rc=${result.exit_code}: ${(
          result.stderr_tail || result.stdout_tail || t("instances.errors.action")
        ).split("\n").slice(-5).join(" | ")}`,
      );
    }
  }

  async function refreshOne(id: number) {
    try {
      const res = await serverInstancesApi.get(id);
      setInstances((prev) => prev.map((i) => (i.id === id ? res.data : i)));
    } catch { /* ignore */ }
  }

  // -------------------------------------------------------------------------
  // Lifecycle action dispatcher
  // -------------------------------------------------------------------------

  type LifecycleAction =
    | "start" | "stop" | "restart" | "update" | "backup" | "probe";

  async function runAction(id: number, action: LifecycleAction) {
    setBusyId({ id, action });
    setError(""); setSuccess("");
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
      if (expandedId === id) await loadActionLog(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("instances.errors.action"));
    } finally {
      setBusyId(null);
    }
  }

  async function handleUpdate(inst: ServerInstance) {
    if (!window.confirm(t("instances.confirmUpdate", { name: inst.name }))) return;
    await runAction(inst.id, "update");
  }

  // -------------------------------------------------------------------------
  // Per-instance log drawer
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
  // Create / edit form
  // -------------------------------------------------------------------------

  function openCreate() {
    setEditingId(null);
    setForm({ ...emptyForm, machine_id: machines[0]?.id ?? 0 });
    setShowForm(true);
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
      admin_password: "",
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
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm({ ...emptyForm });
  }

  function setField<K extends keyof ServerInstanceCreate>(
    key: K, value: ServerInstanceCreate[K],
  ): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submitForm(evt: React.FormEvent) {
    evt.preventDefault();
    setSaving(true); setError("");
    try {
      if (editingId === null) {
        await serverInstancesApi.create(form);
      } else {
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
        if (form.admin_password)  payload.admin_password  = form.admin_password;
        if (form.server_password) payload.server_password = form.server_password;
        await serverInstancesApi.update(editingId, payload);
      }
      setSuccess(t("instances.form.save"));
      await loadInstances();
      closeForm();
    } catch (e) {
      setError(e instanceof Error ? e.message
        : t(editingId === null ? "instances.errors.create" : "instances.errors.update"));
    } finally {
      setSaving(false);
    }
  }

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
  // Scan + import-orphan
  // -------------------------------------------------------------------------

  async function handleScanAll() {
    setError("");
    if (machines.length === 0) return;
    for (const m of machines) {
      setScanningMachineId(m.id);
      try {
        await containersApi.scanMachine(m.id);
      } catch {
        // Per-machine failures don't abort the bulk scan; the missing
        // machine simply contributes 0 orphans.
      }
    }
    setScanningMachineId(null);
    await loadDiscoveredCache();
    setSuccess(t("instances.scanDone", { count: machines.length }));
  }

  function openImport(c: DiscoveredContainer) {
    setImportingFor(c);
    setImportForm(emptyImportForm(c));
  }
  function closeImport() {
    setImportingFor(null);
    setImportForm(null);
  }
  async function submitImport(evt: React.FormEvent) {
    evt.preventDefault();
    if (!importingFor || !importForm) return;
    setImporting(true); setError("");
    try {
      await serverInstancesApi.importFromContainer({
        machine_id:      importingFor.machine_id,
        container_name:  importingFor.name,
        admin_password:  importForm.admin_password,
        server_password: importForm.server_password || undefined,
        display_name:    importForm.display_name,
        map_name:        importForm.map_name,
        game_port:       importForm.game_port,
        rcon_port:       importForm.rcon_port,
      });
      setSuccess(t("instances.importDone", { name: importingFor.name }));
      closeImport();
      await loadInstances();
    } catch (e) {
      const detail =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? (e instanceof Error ? e.message : t("instances.errors.import"));
      setError(detail);
    } finally {
      setImporting(false);
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const filteredInstances = filterMachineId === "all"
    ? instances
    : instances.filter((i) => i.machine_id === filterMachineId);

  const isAnyScanning = scanningMachineId !== null;

  return (
    <div>
      {/* ── Page header ─────────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">
            <Server size={20} /> {t("instances.title")}
          </h1>
          <p className="page-subtitle">
            {t("instances.subtitle")}
            {filteredInstances.length > 0 && (
              <span className="page-subtitle-count">
                {" "}{t("instances.subtitleCount", { count: filteredInstances.length })}
              </span>
            )}
          </p>
        </div>
        <div className="page-header-actions">
          <select
            className="form-input"
            value={filterMachineId}
            onChange={(e) =>
              setFilterMachineId(
                e.target.value === "all" ? "all" : Number(e.target.value),
              )
            }
            aria-label={t("instances.filterMachine")}
          >
            <option value="all">{t("instances.filterAll")}</option>
            {machines.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          <button
            className="btn btn-secondary"
            onClick={handleScanAll}
            disabled={isAnyScanning || machines.length === 0}
          >
            <RefreshCw size={14} style={{ animation: isAnyScanning ? "spin 1s linear infinite" : "none" }} />
            {isAnyScanning ? t("instances.scanning") : t("instances.scanAll")}
          </button>
          <button
            className="btn btn-primary"
            onClick={openCreate}
            disabled={machines.length === 0}
          >
            <Plus size={14} /> {t("instances.newButton")}
          </button>
        </div>
      </div>

      {/* ── Feedback alerts ─────────────────────────────────────────── */}
      {error && (
        <div className="alert alert-error mb-6">
          <span className="alert-icon">!</span> {error}
        </div>
      )}
      {success && (
        <div className="alert alert-success mb-6">
          <span className="alert-icon">✓</span> {success}
        </div>
      )}

      {/* ── Create / edit form ─────────────────────────────────────── */}
      {showForm && (
        <div className="card card-form mb-8">
          <h2 className="card-title">
            <span className="card-title-icon">{editingId === null ? "+" : "~"}</span>
            {editingId === null ? t("instances.form.newTitle") : t("instances.form.editTitle")}
          </h2>
          <form onSubmit={submitForm}>
            <div className="form-grid">
              <div className="form-group form-group-2">
                <label className="form-label">{t("instances.form.machine")}</label>
                <select
                  className="form-input"
                  value={form.machine_id || ""}
                  onChange={(e) => setField("machine_id", Number(e.target.value))}
                  disabled={editingId !== null}
                  required
                >
                  <option value="" disabled>—</option>
                  {machines.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-group form-group-2">
                <label className="form-label">{t("instances.form.name")}</label>
                <input
                  className="form-input"
                  value={form.name}
                  onChange={(e) => setField("name", e.target.value)}
                  pattern="[a-zA-Z0-9][a-zA-Z0-9_\-]*"
                  disabled={editingId !== null}
                  required
                />
                <span className="form-hint">{t("instances.form.nameHint")}</span>
              </div>

              <div className="form-group form-group-2">
                <label className="form-label">{t("instances.form.displayName")}</label>
                <input
                  className="form-input"
                  value={form.display_name ?? ""}
                  onChange={(e) => setField("display_name", e.target.value)}
                />
              </div>

              <div className="form-group form-group-full">
                <label className="form-label">{t("instances.form.description")}</label>
                <input
                  className="form-input"
                  value={form.description ?? ""}
                  onChange={(e) => setField("description", e.target.value)}
                />
              </div>

              <div className="form-group form-group-2">
                <label className="form-label">{t("instances.form.map")}</label>
                <input
                  className="form-input"
                  value={form.map_name ?? ""}
                  onChange={(e) => setField("map_name", e.target.value)}
                  required
                />
              </div>
              <div className="form-group form-group-2">
                <label className="form-label">{t("instances.form.sessionName")}</label>
                <input
                  className="form-input"
                  value={form.session_name ?? ""}
                  onChange={(e) => setField("session_name", e.target.value)}
                />
              </div>
              <div className="form-group form-group-1">
                <label className="form-label">{t("instances.form.maxPlayers")}</label>
                <input
                  className="form-input"
                  type="number"
                  min={1} max={500}
                  value={form.max_players ?? 70}
                  onChange={(e) => setField("max_players", Number(e.target.value))}
                />
              </div>
              <div className="form-group form-group-1">
                <label className="form-label">{t("instances.form.cluster")}</label>
                <input
                  className="form-input"
                  value={form.cluster_id ?? ""}
                  onChange={(e) => setField("cluster_id", e.target.value)}
                />
              </div>

              <div className="form-group form-group-1">
                <label className="form-label">{t("instances.form.gamePort")}</label>
                <input
                  className="form-input"
                  type="number" min={1} max={65535}
                  value={form.game_port ?? 7777}
                  onChange={(e) => setField("game_port", Number(e.target.value))}
                />
              </div>
              <div className="form-group form-group-1">
                <label className="form-label">{t("instances.form.rconPort")}</label>
                <input
                  className="form-input"
                  type="number" min={1} max={65535}
                  value={form.rcon_port ?? 27020}
                  onChange={(e) => setField("rcon_port", Number(e.target.value))}
                />
              </div>
              <div className="form-group form-group-2">
                <label className="form-label">{t("instances.form.adminPassword")}</label>
                <input
                  className="form-input"
                  type="password"
                  value={form.admin_password}
                  onChange={(e) => setField("admin_password", e.target.value)}
                  minLength={editingId === null ? 4 : 0}
                  required={editingId === null}
                />
                {editingId !== null && (
                  <span className="form-hint">{t("instances.form.adminPasswordEditHint")}</span>
                )}
              </div>
              <div className="form-group form-group-2">
                <label className="form-label">{t("instances.form.serverPassword")}</label>
                <input
                  className="form-input"
                  type="password"
                  value={form.server_password ?? ""}
                  onChange={(e) => setField("server_password", e.target.value)}
                />
              </div>

              <div className="form-group form-group-3">
                <label className="form-label">{t("instances.form.image")}</label>
                <input
                  className="form-input"
                  value={form.image ?? ""}
                  onChange={(e) => setField("image", e.target.value)}
                />
              </div>
              <div className="form-group form-group-1">
                <label className="form-label">{t("instances.form.memLimit")}</label>
                <input
                  className="form-input"
                  type="number" min={1024} max={131072}
                  value={form.mem_limit_mb ?? 16384}
                  onChange={(e) => setField("mem_limit_mb", Number(e.target.value))}
                />
              </div>
              <div className="form-group form-group-2">
                <label className="form-label">{t("instances.form.timezone")}</label>
                <input
                  className="form-input"
                  value={form.timezone ?? ""}
                  onChange={(e) => setField("timezone", e.target.value)}
                />
              </div>

              <div className="form-group form-group-3">
                <label className="form-label">{t("instances.form.mods")}</label>
                <input
                  className="form-input"
                  value={form.mods ?? ""}
                  onChange={(e) => setField("mods", e.target.value)}
                />
              </div>
              <div className="form-group form-group-3">
                <label className="form-label">{t("instances.form.passiveMods")}</label>
                <input
                  className="form-input"
                  value={form.passive_mods ?? ""}
                  onChange={(e) => setField("passive_mods", e.target.value)}
                />
              </div>
              <div className="form-group form-group-3">
                <label className="form-label">{t("instances.form.customArgs")}</label>
                <input
                  className="form-input"
                  value={form.custom_args ?? ""}
                  onChange={(e) => setField("custom_args", e.target.value)}
                />
              </div>
              <div className="form-group form-group-3">
                <label className="form-label">{t("instances.form.pokBaseDir")}</label>
                <input
                  className="form-input"
                  value={form.pok_base_dir ?? ""}
                  onChange={(e) => setField("pok_base_dir", e.target.value)}
                />
              </div>

              <div className="form-group form-group-1">
                <label className="form-label">{t("instances.form.updateRole")}</label>
                <select
                  className="form-input"
                  value={form.update_coordination_role ?? "FOLLOWER"}
                  onChange={(e) =>
                    setField("update_coordination_role", e.target.value as UpdateCoordinationRole)
                  }
                >
                  <option value="FOLLOWER">FOLLOWER</option>
                  <option value="MASTER">MASTER</option>
                </select>
              </div>
              <div className="form-group form-group-1">
                <label className="form-label">{t("instances.form.updatePriority")}</label>
                <input
                  className="form-input"
                  type="number" min={0} max={100}
                  value={form.update_coordination_priority ?? 1}
                  onChange={(e) => setField("update_coordination_priority", Number(e.target.value))}
                />
              </div>
            </div>

            <fieldset className="form-fieldset mt-6">
              <legend className="form-legend">{t("instances.form.flags")}</legend>
              <div className="form-row">
                {([
                  ["mod_api",          t("instances.form.modApi")],
                  ["battleye",         t("instances.form.battleye")],
                  ["update_server",    t("instances.form.updateServer")],
                  ["cpu_optimization", t("instances.form.cpuOptimization")],
                ] as Array<[keyof ServerInstanceCreate, string]>).map(([k, label]) => (
                  <label key={k as string} className="form-label-inline">
                    <input
                      className="form-checkbox"
                      type="checkbox"
                      checked={!!form[k]}
                      onChange={(e) => setField(k, e.target.checked as never)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="form-actions">
              <button
                type="submit" className="btn btn-primary"
                disabled={saving || !form.machine_id}
              >
                {saving ? t("instances.form.saving") : t("instances.form.save")}
              </button>
              <button type="button" className="btn btn-secondary" onClick={closeForm}>
                {t("instances.form.cancel")}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Registered instances ─────────────────────────────────────── */}
      {loading ? (
        <p className="card-text">{t("instances.loading")}</p>
      ) : filteredInstances.length === 0 ? (
        <div className="card card-muted">
          <p className="card-text">{t("instances.noInstances")}</p>
        </div>
      ) : (
        <div className="card-grid card-grid-1col">
          {filteredInstances.map((inst) => (
            <InstanceCard
              key={inst.id}
              inst={inst}
              busyId={busyId}
              isAdmin={isAdmin}
              expanded={expandedId === inst.id}
              actions={actionLog[inst.id]}
              machineLabel={machineName(inst.machine_id)}
              statusBadgeClass={statusBadgeClass}
              onToggle={() => toggleExpanded(inst.id)}
              onAction={(a) => runAction(inst.id, a)}
              onUpdate={() => handleUpdate(inst)}
              onEdit={() => openEdit(inst)}
              onDelete={() => handleDelete(inst)}
            />
          ))}
        </div>
      )}

      {/* ── Discovered orphan containers ────────────────────────────── */}
      {orphans.length > 0 && (
        <div className="mt-8">
          <h2 className="card-title" style={{ marginBottom: "0.6rem" }}>
            <span className="card-title-icon"><Search size={14} /></span>
            {t("instances.orphansTitle", { count: orphans.length })}
          </h2>
          <p className="card-text mb-6">{t("instances.orphansHint")}</p>
          <div className="card-grid card-grid-1col">
            {orphans.map((c) => (
              <OrphanCard
                key={`${c.machine_id}-${c.name}`}
                container={c}
                machineLabel={machineName(c.machine_id)}
                onImport={() => openImport(c)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Import dialog (rendered as inline card, scrolls into view) ── */}
      {importingFor && importForm && (
        <div className="card card-form mt-8">
          <h2 className="card-title">
            <span className="card-title-icon"><PackagePlus size={14} /></span>
            {t("instances.importTitle", { name: importingFor.name })}
          </h2>
          <p className="card-text mb-6">
            {t("instances.importHint", { machine: machineName(importingFor.machine_id) })}
          </p>
          <form onSubmit={submitImport}>
            <div className="form-grid">
              <div className="form-group form-group-3">
                <label className="form-label">{t("instances.form.displayName")}</label>
                <input
                  className="form-input"
                  value={importForm.display_name}
                  onChange={(e) => setImportForm({ ...importForm, display_name: e.target.value })}
                />
              </div>
              <div className="form-group form-group-3">
                <label className="form-label">{t("instances.form.map")}</label>
                <input
                  className="form-input"
                  value={importForm.map_name}
                  onChange={(e) => setImportForm({ ...importForm, map_name: e.target.value })}
                />
              </div>
              <div className="form-group form-group-1">
                <label className="form-label">{t("instances.form.gamePort")}</label>
                <input
                  className="form-input" type="number" min={1} max={65535}
                  value={importForm.game_port}
                  onChange={(e) => setImportForm({ ...importForm, game_port: Number(e.target.value) })}
                />
              </div>
              <div className="form-group form-group-1">
                <label className="form-label">{t("instances.form.rconPort")}</label>
                <input
                  className="form-input" type="number" min={1} max={65535}
                  value={importForm.rcon_port}
                  onChange={(e) => setImportForm({ ...importForm, rcon_port: Number(e.target.value) })}
                />
              </div>
              <div className="form-group form-group-2">
                <label className="form-label">{t("instances.form.adminPassword")}</label>
                <input
                  className="form-input" type="password" minLength={4} required
                  value={importForm.admin_password}
                  onChange={(e) => setImportForm({ ...importForm, admin_password: e.target.value })}
                />
              </div>
              <div className="form-group form-group-2">
                <label className="form-label">{t("instances.form.serverPassword")}</label>
                <input
                  className="form-input" type="password"
                  value={importForm.server_password}
                  onChange={(e) => setImportForm({ ...importForm, server_password: e.target.value })}
                />
              </div>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={importing}>
                {importing ? t("instances.form.saving") : t("instances.importConfirm")}
              </button>
              <button type="button" className="btn btn-secondary" onClick={closeImport}>
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
// Sub-components (kept local because they are page-specific)
// ---------------------------------------------------------------------------

interface InstanceCardProps {
  inst: ServerInstance;
  busyId: { id: number; action: string } | null;
  isAdmin: boolean;
  expanded: boolean;
  actions: InstanceAction[] | undefined;
  machineLabel: string;
  statusBadgeClass: (s: InstanceStatus) => string;
  onToggle: () => void;
  onAction: (a: "start" | "stop" | "restart" | "backup" | "probe") => void;
  onUpdate: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function InstanceCard(p: InstanceCardProps) {
  const { t } = useTranslation();
  const { inst, busyId, isAdmin, expanded, actions } = p;
  const busy = busyId?.id === inst.id;

  return (
    <div className={`machine-card ${!inst.is_active ? "machine-card-inactive" : ""}`}>
      <div className="machine-card-header" onClick={p.onToggle} style={{ cursor: "pointer" }}>
        <div className="machine-card-info">
          <h3 className="machine-card-name">
            {inst.display_name || inst.name}
            <span className="machine-card-tag">{inst.map_name}</span>
            {inst.cluster_id && <span className="machine-card-tag">cluster: {inst.cluster_id}</span>}
          </h3>
          <p className="machine-card-host">
            {p.machineLabel} &middot; {inst.container_name} &middot; {inst.game_port}/{inst.rcon_port}
          </p>
          {inst.description && <p className="machine-card-desc">{inst.description}</p>}
        </div>
        <div className="machine-card-status">
          <span className={p.statusBadgeClass(inst.status)}>
            <span className="badge-dot" />
            {t(`instances.status.${inst.status}`)}
          </span>
          <span className="machine-card-expand">
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </span>
        </div>
      </div>

      {/* Always-visible action toolbar */}
      <div className="machine-card-actions">
        <ActionBtn icon={<Play     size={14} />} label={t("instances.actions.start")}   busy={busy && busyId?.action === "start"}   disabled={!!busyId} onClick={() => p.onAction("start")} />
        <ActionBtn icon={<Square   size={14} />} label={t("instances.actions.stop")}    busy={busy && busyId?.action === "stop"}    disabled={!!busyId} onClick={() => p.onAction("stop")} />
        <ActionBtn icon={<RotateCw size={14} />} label={t("instances.actions.restart")} busy={busy && busyId?.action === "restart"} disabled={!!busyId} onClick={() => p.onAction("restart")} />
        <ActionBtn icon={<Activity size={14} />} label={t("instances.actions.probe")}   busy={busy && busyId?.action === "probe"}   disabled={!!busyId} onClick={() => p.onAction("probe")} />
        <ActionBtn icon={<Download size={14} />} label={t("instances.actions.backup")}  busy={busy && busyId?.action === "backup"}  disabled={!!busyId} onClick={() => p.onAction("backup")} />
        <ActionBtn icon={<DownloadCloud size={14} />} label={t("instances.actions.update")} busy={busy && busyId?.action === "update"} disabled={!!busyId} onClick={p.onUpdate} />
        <button className="btn btn-ghost btn-sm" onClick={p.onEdit} title={t("instances.actions.edit")}>
          <Pencil size={14} />
        </button>
        {isAdmin && (
          <button className="btn btn-danger btn-sm" onClick={p.onDelete} title={t("instances.actions.delete")}>
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {expanded && (
        <div className="machine-card-body">
          <h4 className="form-label" style={{ marginTop: "0.7rem" }}>
            {t("instances.log.title", { name: inst.display_name || inst.name })}
          </h4>
          {!actions ? (
            <p className="card-text">…</p>
          ) : actions.length === 0 ? (
            <p className="card-text">{t("instances.log.empty")}</p>
          ) : (
            <div className="card-grid card-grid-1col" style={{ gap: "0.4rem", marginTop: "0.4rem" }}>
              {actions.map((a) => (
                <details key={a.id} className="card card-muted" style={{ padding: "0.45rem 0.7rem" }}>
                  <summary style={{ cursor: "pointer", display: "flex", gap: "0.7rem", flexWrap: "wrap", fontSize: "0.78rem" }}>
                    <span style={{ fontWeight: 700 }}>{a.action}</span>
                    <span className={
                      a.status === "success" ? "form-message form-message-success"
                      : a.status === "failed" ? "form-message form-message-error"
                      : "form-message"
                    }>{a.status}</span>
                    <span style={{ color: "var(--text-muted)" }}>rc {a.exit_code ?? "—"}</span>
                    <span style={{ color: "var(--text-muted)" }}>{a.duration_ms ?? "—"} ms</span>
                    <span style={{ color: "var(--text-muted)" }}>{a.started_at ?? ""}</span>
                    {a.username && <span style={{ color: "var(--text-muted)" }}>@{a.username}</span>}
                  </summary>
                  <pre className="form-input" style={{ marginTop: "0.4rem", maxHeight: 220, overflow: "auto", whiteSpace: "pre-wrap", fontSize: "0.72rem" }}>
                    {a.stdout || a.stderr || t("instances.log.noStdout")}
                  </pre>
                </details>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface OrphanCardProps {
  container: DiscoveredContainer;
  machineLabel: string;
  onImport: () => void;
}

function OrphanCard({ container, machineLabel, onImport }: OrphanCardProps) {
  const { t } = useTranslation();
  return (
    <div className="machine-card machine-card-inactive">
      <div className="machine-card-header">
        <div className="machine-card-info">
          <h3 className="machine-card-name">
            {container.server_name || container.name}
            <span className="machine-card-tag">{container.map_name || "?"}</span>
            <span className={
              container.process_running
                ? "badge badge-md badge-online"
                : "badge badge-md badge-offline"
            }>
              <span className="badge-dot" />
              {container.status || (container.process_running ? "running" : "stopped")}
            </span>
          </h3>
          <p className="machine-card-host">
            {machineLabel} &middot; {container.name}
            {container.path && <> &middot; <code>{container.path}</code></>}
          </p>
          {container.plugins?.length > 0 && (
            <p className="machine-card-desc">
              {t("instances.orphanPlugins", { plugins: container.plugins.join(", ") })}
            </p>
          )}
        </div>
        <div className="machine-card-status">
          <button className="btn btn-primary btn-sm" onClick={onImport}>
            <PackagePlus size={14} /> {t("instances.importButton")}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ActionBtnProps {
  icon: React.ReactNode;
  label: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}

function ActionBtn({ icon, label, busy, disabled, onClick }: ActionBtnProps) {
  const { t } = useTranslation();
  return (
    <button
      className="btn btn-ghost btn-sm"
      disabled={disabled}
      onClick={onClick}
      title={label}
    >
      {busy ? <span style={{ fontSize: "0.7rem" }}>{t("instances.actions.running")}</span> : icon}
    </button>
  );
}
