/**
 * api.ts — Axios-based HTTP client for the ArkManiaGest FastAPI backend.
 *
 * All backend communication goes through the named API objects exported from
 * this module (e.g. {@link authApi}, {@link machinesApi}, {@link playersApi}).
 * Each object groups endpoints by domain, mirroring the backend router structure.
 *
 * Authentication:
 *   The JWT token is stored in the module-level {@link _authToken} variable
 *   (NOT in localStorage) to prevent XSS-based token theft.  Use
 *   {@link setAuthToken} / {@link getAuthToken} to manage the token lifecycle.
 *
 * Error handling:
 *   - 401 on a protected endpoint → token is cleared and {@link _onAuthError}
 *     callback is invoked (triggers redirect to login in App.tsx).
 *   - 503 → backend unreachable; same callback.
 *   - All other errors are left for individual callers to handle.
 */

import axios from "axios";
import type {
  AppSettings,
  AppSettingsUpdate,
  DualDatabaseConfig,
  DatabaseTestRequest,
  DatabaseTestResult,
  VersionCheckResult,
  SSHMachine,
  SSHMachineCreate,
  SSHMachineUpdate,
  SSHTestResult,
  SFMachine,
  SFContainer,
  SFCluster,
  SFImportPreview,
  SFImportRequest,
  PlayerListItem,
  PlayerFull,
  PlayersStats,
  PermissionGroupItem,
  AuthUser,
  LoginResponse,
  ServerInstance,
  ServerInstanceCreate,
  ServerInstanceUpdate,
  InstanceActionResult,
  InstanceAction,
  InstanceActionKind,
  InstanceActionStatus,
} from "../types";

// ---------------------------------------------------------------------------
// Base URL
// ---------------------------------------------------------------------------

/**
 * In production the frontend is served from the same origin as the API (via
 * Nginx proxy), so we use a relative path.  In development the Vite dev server
 * runs separately from FastAPI, so we point directly at localhost:8000.
 */
const API_BASE =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD ? "/api/v1" : "http://localhost:8000/api/v1");

const api = axios.create({
  baseURL: API_BASE,
  timeout: 30_000,
  headers: { "Content-Type": "application/json" },
});

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------
//
// The JWT is kept in sessionStorage (NOT localStorage) and mirrored in a
// module-level variable.  sessionStorage survives F5 inside the same tab
// -- which the old in-memory-only approach did not, and which forced the
// operator back to the login page on every single page reload.  It does
// NOT survive closing the tab, so the attack surface is still narrower
// than localStorage: an attacker who lands an XSS on the panel only gets
// the token while the tab is open anyway.
//
// The proper long-term fix is an httpOnly cookie issued by the backend,
// but that needs a CSRF token on every mutating request which is a much
// bigger change; sessionStorage is the pragmatic middle ground.

const _AUTH_TOKEN_KEY = "arkmaniagest.authToken";

function _loadToken(): string | null {
  try {
    return window.sessionStorage.getItem(_AUTH_TOKEN_KEY);
  } catch {
    // Sandbox / privacy mode: sessionStorage may throw.  Fall back to memory.
    return null;
  }
}

function _storeToken(token: string | null): void {
  try {
    if (token) {
      window.sessionStorage.setItem(_AUTH_TOKEN_KEY, token);
    } else {
      window.sessionStorage.removeItem(_AUTH_TOKEN_KEY);
    }
  } catch {
    /* sessionStorage unavailable -- we still have the in-memory copy. */
  }
}

let _authToken: string | null = _loadToken();
/** Callback invoked when a 401 / 503 response clears the token. */
let _onAuthError: (() => void) | null = null;

/** Store the JWT after a successful login. */
export function setAuthToken(token: string | null): void {
  _authToken = token;
  _storeToken(token);
}

/** Read the current JWT (e.g. to inspect expiry in tests). */
export function getAuthToken(): string | null {
  return _authToken;
}

/**
 * Register a callback that is invoked when the user's session expires or
 * the backend becomes unavailable.  Typically used to redirect to the login page.
 */
export function setOnAuthError(callback: () => void): void {
  _onAuthError = callback;
}

// ---------------------------------------------------------------------------
// Interceptors
// ---------------------------------------------------------------------------

/** Attach the JWT to every outgoing request. */
api.interceptors.request.use((config) => {
  if (_authToken) {
    config.headers.Authorization = `Bearer ${_authToken}`;
  }
  return config;
});

/**
 * Response interceptor: handles session expiry and backend unavailability.
 *
 * Only 401 and 503 errors are handled here.  All other error statuses are
 * passed through to the individual call-site handlers so pages can display
 * context-specific messages.
 */
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status: number | undefined = error.response?.status;
    const url: string = error.config?.url ?? "";

    // FastAPI returns `detail: string` for HTTPException raises, but for
    // Pydantic validation failures it returns
    //     detail: [{ type, loc, msg, input }, ...]
    // Page-level handlers across the codebase do
    //     setError(err.response.data.detail)
    // which then tries to render an object directly into JSX -- React
    // explodes with the unhelpful Minified-Error #31.  Coerce arrays /
    // objects into a readable single-line string here so every page is
    // safe regardless of what FastAPI happened to return.
    const data = error.response?.data;
    if (data && data.detail !== undefined && typeof data.detail !== "string") {
      const raw = data.detail;
      let coerced = "";
      if (Array.isArray(raw)) {
        coerced = raw
          .map((it) =>
            it && typeof it === "object" && "msg" in it
              ? String((it as { msg: unknown }).msg)
              : JSON.stringify(it),
          )
          .join("; ");
      } else {
        try { coerced = JSON.stringify(raw); }
        catch { coerced = String(raw); }
      }
      data.detail = coerced;
    }

    // Log non-2xx errors in development for easier debugging
    if (status && status >= 400) {
      console.warn(
        `[API ${status}] ${error.config?.method?.toUpperCase()} ${url}:`,
        error.response?.data?.detail ?? error.message
      );
    }

    // 401 on a protected endpoint = expired / invalid token → force re-login
    const isLoginEndpoint = url.includes("/auth/login");
    if (status === 401 && _authToken && !isLoginEndpoint) {
      console.warn("[AUTH] Token expired or invalid — redirecting to login.");
      _authToken = null;
      _onAuthError?.();
    }

    // 503 = backend process is down
    if (status === 503) {
      console.warn("[AUTH] Backend unavailable (503).");
      _authToken = null;
      _onAuthError?.();
    }

    return Promise.reject(error);
  }
);

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/** Endpoints for login and current-user operations. */
export const authApi = {
  /** Authenticate with username/password and receive a JWT. */
  login: (username: string, password: string) =>
    api.post<LoginResponse>("/auth/login", { username, password }),

  /** Return the profile of the currently authenticated user. */
  me: () => api.get<AuthUser>("/auth/me"),

  /** Change the current user's own password. */
  changePassword: (old_password: string, new_password: string) =>
    api.put("/auth/me/password", { old_password, new_password }),
};

// ---------------------------------------------------------------------------
// User management (admin only)
// ---------------------------------------------------------------------------

/** CRUD operations on application user accounts. */
export const usersApi = {
  list: () => api.get<AuthUser[]>("/users"),
  create: (data: {
    username: string;
    password: string;
    display_name: string;
    role: string;
  }) => api.post<AuthUser>("/users", data),
  update: (
    id: number,
    data: { display_name?: string; role?: string; active?: boolean; password?: string }
  ) => api.put<AuthUser>(`/users/${id}`, data),
  delete: (id: number) => api.delete(`/users/${id}`),
};

// ---------------------------------------------------------------------------
// App settings & setup
// ---------------------------------------------------------------------------

/** Application-level configuration and first-run setup. */
export const settingsApi = {
  /** Check whether the app has been configured (at least one user exists). */
  status: () =>
    api.get<{ configured: boolean; users_count: number; db_connected: boolean }>(
      "/settings/status"
    ),

  /** First-run setup: create the initial admin user and basic settings. */
  setup: (data: {
    admin_username: string;
    admin_password: string;
    admin_display_name?: string;
    app_name?: string;
    log_level?: string;
  }) => api.post("/settings/setup", data),

  get: () => api.get<AppSettings>("/settings/app-settings"),
  update: (data: AppSettingsUpdate) =>
    api.put<AppSettings>("/settings/app-settings", data),

  /**
   * Ask the backend to query GitHub for the latest release and compare it
   * against the running version.  Pass `force=true` to bypass the 1-hour
   * server-side cache (useful for the manual "Check now" button).
   */
  checkVersion: (force = false) =>
    api.get<VersionCheckResult>("/settings/version-check", {
      params: force ? { force: true } : undefined,
    }),
};

// ---------------------------------------------------------------------------
// Database configuration
// ---------------------------------------------------------------------------

/** Read-only access to DB config and connectivity testing. */
export const databaseApi = {
  /** Returns config for both panel and plugin databases. */
  get: () => api.get<DualDatabaseConfig>("/settings/database"),
  test: (data: DatabaseTestRequest) =>
    api.post<DatabaseTestResult>("/settings/database/test", data),
  /** Tests the panel DB with the credentials currently in .env. */
  testCurrent: () => api.post<DatabaseTestResult>("/settings/database/test-current"),
  /** Tests the plugin DB with the credentials currently in .env. */
  testPlugin: () => api.post<DatabaseTestResult>("/settings/database/test-plugin"),
};

// ---------------------------------------------------------------------------
// SSH machines
// ---------------------------------------------------------------------------

/** CRUD operations and connectivity testing for SSH machine records. */
export const machinesApi = {
  list: (activeOnly = false) =>
    api.get<SSHMachine[]>("/machines", { params: { active_only: activeOnly } }),
  get: (id: number) => api.get<SSHMachine>(`/machines/${id}`),
  create: (data: SSHMachineCreate) => api.post<SSHMachine>("/machines", data),
  update: (id: number, data: SSHMachineUpdate) =>
    api.put<SSHMachine>(`/machines/${id}`, data),
  delete: (id: number) => api.delete(`/machines/${id}`),
  duplicate: (id: number) => api.post<SSHMachine>(`/machines/${id}/duplicate`),
  test: (id: number) => api.post<SSHTestResult>(`/machines/${id}/test`),
  count: () =>
    api.get<{ total: number; active: number; online: number }>("/machines/count"),
};

// ---------------------------------------------------------------------------
// Server instances (ARK game server Docker containers managed via POK-manager)
// ---------------------------------------------------------------------------

export const serverInstancesApi = {
  list: (params?: { machine_id?: number; active_only?: boolean }) =>
    api.get<ServerInstance[]>("/servers", { params }),
  get: (id: number) => api.get<ServerInstance>(`/servers/${id}`),
  create: (data: ServerInstanceCreate) =>
    api.post<ServerInstance>("/servers", data),
  update: (id: number, data: ServerInstanceUpdate) =>
    api.put<ServerInstance>(`/servers/${id}`, data),
  delete: (id: number, purgeOnHost = false) =>
    api.delete(`/servers/${id}`, { params: { purge_on_host: purgeOnHost } }),

  // Lifecycle actions (all return an InstanceActionResult)
  start:   (id: number) => api.post<InstanceActionResult>(`/servers/${id}/start`),
  stop:    (id: number) => api.post<InstanceActionResult>(`/servers/${id}/stop`),
  restart: (id: number) => api.post<InstanceActionResult>(`/servers/${id}/restart`),
  // POK update pulls the latest ASA build from Steam; it can run for
  // 10+ minutes, well past axios' 30s default, so we bump the per-call
  // timeout to 30 minutes.  The backend also respects SSH_TIMEOUT.
  update_: (id: number) =>
    api.post<InstanceActionResult>(
      `/servers/${id}/update`,
      null,
      { timeout: 30 * 60 * 1000 },
    ),
  backup:  (id: number) => api.post<InstanceActionResult>(`/servers/${id}/backup`),
  status:  (id: number) => api.post<InstanceActionResult>(`/servers/${id}/status`),
  rcon:    (id: number, command: string) =>
    api.post<InstanceActionResult>(`/servers/${id}/rcon`, { command }),

  // Per-instance action log (most recent first)
  actions: (id: number, params?: { limit?: number; offset?: number }) =>
    api.get<InstanceAction[]>(`/servers/${id}/actions`, { params }),

  // Promote a scanned-but-unregistered container into a real ARKM_server_instances row.
  importFromContainer: (data: ImportFromContainerRequest) =>
    api.post<ServerInstance>("/servers/import-from-container", data),
};

/** Body for serverInstancesApi.importFromContainer. */
export interface ImportFromContainerRequest {
  machine_id:      number;
  container_name:  string;
  admin_password:  string;
  server_password?: string | null;
  display_name?:    string;
  map_name?:        string;
  game_port?:       number;
  rcon_port?:       number;
}

// Back-compat alias so legacy imports of `serversApi` keep working.
export const serversApi = serverInstancesApi;

// ---------------------------------------------------------------------------
// Instance action log (global view with filters)
// ---------------------------------------------------------------------------

export const instanceActionsApi = {
  list: (params?: {
    instance_id?: number;
    machine_id?: number;
    action?: InstanceActionKind;
    status?: InstanceActionStatus;
    limit?: number;
    offset?: number;
  }) => api.get<InstanceAction[]>("/instance-actions", { params }),
};

// ---------------------------------------------------------------------------
// In-panel self-update (Settings > General > "Install update" button)
// ---------------------------------------------------------------------------

export interface SystemUpdatePreflight {
  sudo_authorised: boolean;
  script_present:  boolean;
  repo_configured: boolean;
  repo:            string;
  can_self_update: boolean;
  hint:            string;
}

export interface SystemUpdateStatus {
  state:          "idle" | "downloading" | "verifying" | "running" | "success" | "failed";
  target_version: string | null;
  started_at:     string | null;
  finished_at:    string | null;
  message:        string | null;
  progress_pct:   number | null;
  log_tail:       string | null;
}

export const systemUpdateApi = {
  preflight: () =>
    api.get<SystemUpdatePreflight>("/system-update/preflight"),
  install:   () =>
    api.post<Omit<SystemUpdateStatus, "log_tail" | "started_at" | "finished_at">>(
      "/system-update/install",
      null,
      { timeout: 60_000 },   // download can take a minute on slow links
    ),
  status:    () =>
    api.get<SystemUpdateStatus>("/system-update/status"),
};

// ---------------------------------------------------------------------------
// SSH direct execution (debug utilities)
// ---------------------------------------------------------------------------

export const sshApi = {
  testConnection: (data: unknown) => api.post("/ssh/test-connection", data),
  execute: (data: unknown) => api.post("/ssh/execute", data),
  upload: (data: unknown) => api.post("/ssh/upload", data),
};

// ---------------------------------------------------------------------------
// ServerForge
// ---------------------------------------------------------------------------

/** ServerForge API proxy endpoints for container / cluster management. */
export const sfApi = {
  getConfig: () =>
    api.get<{ has_token: boolean; base_url: string }>("/sf/config"),
  updateConfig: (token: string, base_url?: string) =>
    api.put("/sf/config", { token, base_url }),
  testToken: () =>
    api.post<{ success: boolean; message: string }>("/sf/config/test"),

  machines: () =>
    api.get<{ success: boolean; data: SFMachine[]; total_count: number }>("/sf/machines"),
  machine: (id: number) => api.get<{ success: boolean; data: unknown }>(`/sf/machines/${id}`),

  containers: () =>
    api.get<{ success: boolean; data: SFContainer[]; total_count: number }>("/sf/containers"),
  container: (id: number) =>
    api.get<{ success: boolean; data: unknown }>(`/sf/containers/${id}`),
  containerStatus: (id: number) =>
    api.get<{ success: boolean; data: unknown }>(`/sf/containers/${id}/status`),
  startContainer: (id: number) => api.post(`/sf/containers/${id}/start`),
  stopContainer: (id: number) => api.post(`/sf/containers/${id}/stop`),
  restartContainer: (id: number) => api.post(`/sf/containers/${id}/restart`),

  clusters: () =>
    api.get<{ success: boolean; data: SFCluster[]; total_count: number }>("/sf/clusters"),
  cluster: (id: number) => api.get<{ success: boolean; data: unknown }>(`/sf/clusters/${id}`),

  previewImport: () =>
    api.get<{ machines: SFImportPreview[]; total: number }>("/sf/machines/preview-import"),
  importMachine: (data: SFImportRequest) => api.post("/sf/machines/import", data),
};

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

/** Player management: list, points, permissions, name sync, character copy. */
export const playersApi = {
  list: (params?: {
    search?: string;
    group?: string;
    limit?: number;
    offset?: number;
  }) => api.get<PlayerListItem[]>("/players", { params }),

  stats: () => api.get<PlayersStats>("/players/stats"),

  get: (id: number) => api.get<PlayerFull>(`/players/${id}`),

  update: (
    id: number,
    data: { name?: string; permission_groups?: string; timed_permission_groups?: string }
  ) => api.put(`/players/${id}`, data),

  setPoints: (id: number, points: number) =>
    api.put(`/players/${id}/points`, { points }),

  addPoints: (id: number, amount: number) =>
    api.post(`/players/${id}/points/add`, { amount }),

  permissionGroups: () =>
    api.get<PermissionGroupItem[]>("/players/permissions/groups"),

  updatePermissionGroup: (id: number, permissions: string) =>
    api.put(`/players/permissions/groups/${id}`, { permissions }),

  /**
   * Sync player character names from .arkprofile binary files via SSH.
   *
   * @param machineId    - Restrict to a single machine (omit for all machines).
   * @param containerName - Restrict to a specific container (omit for all containers).
   */
  syncNames: (machineId?: number, containerName?: string) => {
    const params: Record<string, unknown> = {};
    if (machineId) params.machine_id = machineId;
    if (containerName) params.container_name = containerName;
    return api.post("/players/sync-names", null, { params, timeout: 120_000 });
  },

  /**
   * Sibling of syncNames: scans .arktribe binary files instead of
   * .arkprofile and writes the discovered tribe display names into
   * ARKM_player_tribes + ARKM_tribe_decay (matched by targeting_team).
   */
  /**
   * Extend (or grant) the same timed permission group across a batch of
   * players in one call.  Server-side semantics:
   *
   *   * Player already has the group -> expiry := max(current, now)
   *                                              + duration_seconds
   *   * Player does NOT have it      -> entry created with
   *                                     now + duration_seconds
   *
   * Other timed-permission entries are never touched.
   */
  bulkAddTimedPerm: (data: {
    player_ids:        number[];
    group:             string;
    duration_seconds:  number;        // delta to add to current expiry
    flag?:             string;
  }) =>
    api.post<{
      success:           boolean;
      requested:         number;
      updated:           number;       // = extended + added
      extended:          number;       // had the group already
      added:             number;       // did NOT have the group
      missing_ids:       number[];
      group:             string;
      duration_seconds:  number;
    }>("/players/bulk-add-timed-perm", { flag: "0", ...data }),

  /**
   * Align expiry dates inside a family of related timed permissions.
   * Per player: every ACTIVE entry whose group is in `groups` is bumped
   * to the latest active timestamp in the family.  Expired entries are
   * never modified; players with 0 or 1 active family members are
   * counted under `skipped_players`.
   */
  bulkAlignTimedPerms: (data: {
    player_ids: number[];
    groups:     string[];
  }) =>
    api.post<{
      success:          boolean;
      requested:        number;
      aligned_players:  number;
      aligned_entries:  number;
      skipped_players:  number;
      missing_ids:      number[];
      family:           string[];
    }>("/players/bulk-align-timed-perms", data),

  syncTribes: (machineId?: number, containerName?: string) => {
    const params: Record<string, unknown> = {};
    if (machineId) params.machine_id = machineId;
    if (containerName) params.container_name = containerName;
    return api.post<{
      success:                     boolean;
      total_files_scanned:         number;
      matched:                     number;
      player_tribes_rows_updated:  number;
      tribe_decay_rows_updated:    number;
      not_named:                   Array<{file_id: string; tribe_id: number | null; source: string}>;
      not_named_total:             number;
      errors:                      string[];
    }>("/players/sync-tribes", null, { params, timeout: 120_000 });
  },

  /** Return containers eligible for the name sync operation. */
  syncContainers: () => api.get("/players/sync-containers"),

  /**
   * Find all maps where a player's .arkprofile exists.
   *
   * @param eosId     - Player's EOS_Id.
   * @param machineId - Restrict to a single machine (omit for all).
   */
  findPlayerMaps: (eosId: string, machineId?: number) => {
    const params: Record<string, unknown> = { eos_id: eosId, debug: true };
    if (machineId) params.machine_id = machineId;
    return api.get("/players/find-maps", { params, timeout: 120_000 });
  },

  /** Copy a player's .arkprofile from one map/machine to another. */
  copyCharacter: (data: {
    source_machine_id: number;
    source_container: string;
    source_profile_path: string;
    dest_machine_id: number;
    dest_container: string;
    dest_map_name: string;
    backup?: boolean;
  }) => api.post("/players/copy-character", data, { timeout: 120_000 }),
};

// ---------------------------------------------------------------------------
// Blueprints
// ---------------------------------------------------------------------------

export const blueprintsApi = {
  status: () =>
    api.get<{
      has_data: boolean;
      total_blueprints: number;
      last_sync: string | null;
      sources: string[];
      version: number;
    }>("/blueprints/status"),
  testConnection: () => api.get("/blueprints/test-connection"),
  sync: () =>
    api.post<{
      success: boolean;
      total_blueprints: number;
      items_count: number;
      dinos_count: number;
      commands_count: number;
      sources: string[];
      errors: string[];
    }>("/blueprints/sync", null, { timeout: 120_000 }),

  /**
   * Upload a `.beacondata` export from Beacon (https://usebeacon.app)
   * and replace the local blueprint DB with its contents.
   *
   * Beacon's catalog is maintained actively and covers every ASA creature
   * the stale Dododex mirror is missing (Maeguana, Helminth, ...), plus
   * any mods the operator has loaded in Beacon.  Recommended way to
   * populate the DB on fresh installs.
   */
  importBeacondata: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return api.post<{
      success: boolean;
      total_blueprints: number;
      items_count: number;
      dinos_count: number;
      commands_count: number;
      sources: string[];
      errors: string[];
    }>("/blueprints/import-beacondata", fd, {
      // The parse walks ~60MB of JSON -- give the server plenty of time.
      timeout: 180_000,
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  list: (params?: {
    search?: string;
    category?: string;
    type?: string;
    limit?: number;
    offset?: number;
  }) => api.get<{ items: unknown[]; total: number }>("/blueprints", { params }),
  categories: () =>
    api.get<{ categories: { name: string; count: number }[] }>("/blueprints/categories"),
  types: () =>
    api.get<{ types: { name: string; count: number }[] }>("/blueprints/types"),
  clear: () => api.delete("/blueprints"),

  // Category management
  allCategories: () =>
    api.get<{ categories: string[] }>("/blueprints/categories/list"),
  updateCategory: (bpId: string, category: string) =>
    api.put(`/blueprints/${encodeURIComponent(bpId)}/category`, { category }),
  bulkUpdateCategory: (ids: string[], category: string) =>
    api.put("/blueprints/bulk-category", { ids, category }),

  // Import / Export
  exportAll: () =>
    api.get<unknown[]>("/blueprints/export"),
  importBlueprints: (blueprints: unknown[], mode: "merge" | "replace" = "merge") =>
    api.post<{ success: boolean; added: number; updated: number; skipped: number; total: number }>(
      "/blueprints/import", { blueprints, mode }
    ),
};

// ---------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------

export const containersApi = {
  scanMachine: (machineId: number, basePath?: string) =>
    api.post(
      `/containers/machines/${machineId}/scan`,
      null,
      basePath ? { params: { base_path: basePath } } : {}
    ),
  getMachineContainers: (machineId: number) =>
    api.get(`/containers/machines/${machineId}/containers`),
  getAllContainers: () => api.get("/containers/containers"),
  rescanContainer: (machineId: number, containerName: string) =>
    api.post(`/containers/machines/${machineId}/containers/${containerName}/rescan`),
  readFile: (machineId: number, containerName: string, pathKey: string) =>
    api.get(
      `/containers/machines/${machineId}/containers/${containerName}/file`,
      { params: { path_key: pathKey } }
    ),
  writeFile: (
    machineId: number,
    containerName: string,
    pathKey: string,
    content: string,
    backup = true
  ) =>
    api.post(
      `/containers/machines/${machineId}/containers/${containerName}/file`,
      { content, backup },
      { params: { path_key: pathKey } }
    ),
  browse: (machineId: number, containerName: string, subPath = "") =>
    api.get(
      `/containers/machines/${machineId}/containers/${containerName}/browse`,
      { params: { sub_path: subPath } }
    ),
};

// ---------------------------------------------------------------------------
// ArkShop
// ---------------------------------------------------------------------------

export const arkshopApi = {
  servers: () => api.get("/arkshop/servers"),
  pull: (machineId: number, containerName: string) =>
    api.post("/arkshop/pull", null, {
      params: { machine_id: machineId, container_name: containerName },
      timeout: 60_000,
    }),
  deploy: (
    versionId?: number,
    machineId?: number,
    containerName?: string,
    force?: boolean
  ) => {
    const params: Record<string, unknown> = {};
    if (versionId != null) params.version_id = versionId;
    if (machineId != null) params.machine_id = machineId;
    if (containerName) params.container_name = containerName;
    if (force) params.force = true;
    return api.post("/arkshop/deploy", null, { params, timeout: 120_000 });
  },
  listVersions: () => api.get("/arkshop/versions"),
  saveVersion: (label: string) => api.post("/arkshop/versions", { label }),
  restoreVersion: (id: number) => api.post(`/arkshop/versions/${id}/restore`),
  deleteVersion: (id: number) => api.delete(`/arkshop/versions/${id}`),
  getConfig: () => api.get("/arkshop/config"),
  configStatus: () => api.get("/arkshop/config/status"),
  uploadConfig: (config: unknown) => api.post("/arkshop/config", { config }),
  deleteConfig: () => api.delete("/arkshop/config"),
  exportConfig: () => api.get("/arkshop/config/export"),
  getMysql: () => api.get("/arkshop/mysql"),
  updateMysql: (mysql: unknown) => api.put("/arkshop/mysql", { mysql }),
  getGeneral: () => api.get("/arkshop/general"),
  updateGeneral: (general: unknown) => api.put("/arkshop/general", { general }),
  listShopItems: () => api.get("/arkshop/shop-items"),
  updateShopItem: (key: string, item: unknown) =>
    api.put("/arkshop/shop-items", { key, item }),
  deleteShopItem: (key: string) => api.delete(`/arkshop/shop-items/${key}`),
  listKits: () => api.get("/arkshop/kits"),
  updateKit: (key: string, kit: unknown) => api.put("/arkshop/kits", { key, kit }),
  deleteKit: (key: string) => api.delete(`/arkshop/kits/${key}`),
  listSellItems: () => api.get("/arkshop/sell-items"),
  updateSellItem: (key: string, item: unknown) =>
    api.put("/arkshop/sell-items", { key, item }),
  deleteSellItem: (key: string) => api.delete(`/arkshop/sell-items/${key}`),
  getMessages: () => api.get("/arkshop/messages"),
  updateMessages: (messages: unknown) => api.put("/arkshop/messages", { messages }),
};

// ---------------------------------------------------------------------------
// ArkMania plugin configuration
// ---------------------------------------------------------------------------

export const arkmaniaApi = {
  listModules: () => api.get("/arkmania/modules"),
  getModule: (module: string, serverKey = "*") =>
    api.get(`/arkmania/modules/${module}`, { params: { server_key: serverKey } }),
  updateModule: (
    module: string,
    serverKey: string,
    items: { config_key: string; config_value: string; description?: string }[]
  ) => api.put(`/arkmania/modules/${module}`, { server_key: serverKey, items }),

  getConfig: (key: string, serverKey = "*") =>
    api.get("/arkmania/config", { params: { key, server_key: serverKey } }),
  setConfig: (data: {
    config_key: string;
    config_value: string;
    description?: string;
    server_key?: string;
  }) => api.put("/arkmania/config", data),
  addConfig: (data: {
    config_key: string;
    config_value: string;
    description?: string;
    server_key?: string;
  }) => api.post("/arkmania/config", data),
  deleteConfigOverride: (key: string, serverKey: string) =>
    api.delete("/arkmania/config", { params: { key, server_key: serverKey } }),

  listServers: () => api.get("/arkmania/servers"),
  createServer: (data: {
    server_key: string; display_name: string; map_name: string;
    game_mode?: string; server_type?: string; cluster_group?: string; max_players?: number;
  }) => api.post("/arkmania/servers", data),
  updateServer: (serverKey: string, data: unknown) =>
    api.put(`/arkmania/servers/${serverKey}`, data),
  deleteServer: (serverKey: string) =>
    api.delete(`/arkmania/servers/${serverKey}`),
  getServerOverrides: (serverKey: string) =>
    api.get(`/arkmania/servers/${serverKey}/overrides`),

  search: (q: string) => api.get("/arkmania/search", { params: { q } }),
  getOnlinePlayers: (serverKey?: string) =>
    api.get("/arkmania/online", {
      params: serverKey ? { server_key: serverKey } : {},
    }),
  getPermissionGroups: () => api.get("/arkmania/permission-groups"),

  // Event log
  getEvents: (params?: {
    event_type?: string; server_key?: string; search?: string;
    limit?: number; offset?: number;
  }) => api.get("/arkmania/events", { params }),
  getEventStats: () => api.get("/arkmania/events/stats"),
  purgeEvents: (keepDays: number, eventType?: string) =>
    api.delete("/arkmania/events", { params: { keep_days: keepDays, ...(eventType ? { event_type: eventType } : {}) } }),
};

// ---------------------------------------------------------------------------
// ArkMania — Decay
// ---------------------------------------------------------------------------

export const arkDecayApi = {
  overview: () => api.get("/arkmania/decay"),
  tribes: (params?: { status?: string; search?: string; limit?: number }) =>
    api.get("/arkmania/decay/tribes", { params }),
  pending: () => api.get("/arkmania/decay/pending"),
  log: (params?: { limit?: number; server_key?: string }) =>
    api.get("/arkmania/decay/log", { params }),

  /**
   * Schedule a tribe for destruction on every active server in the cluster.
   * The plugin's next purge sweep destroys the actors and logs them.
   */
  schedulePurge: (targetingTeam: number, reason: string = "manual") =>
    api.post<{
      targeting_team: number;
      scheduled_on:   string[];
      rows_inserted:  number;
      reason:         string;
    }>(
      `/arkmania/decay/pending/${targetingTeam}`,
      null,
      { params: { reason } },
    ),

  /**
   * Cancel a queued purge (DELETE rows from ARKM_decay_pending).  Pass a
   * server_key to limit the cancel to one server; omit to cancel the
   * pending entries everywhere.
   */
  cancelPurge: (targetingTeam: number, serverKey?: string) =>
    api.delete<{
      targeting_team: number;
      server_key:     string | null;
      rows_deleted:   number;
    }>(`/arkmania/decay/pending/${targetingTeam}`, {
      params: serverKey ? { server_key: serverKey } : undefined,
    }),

  /**
   * Send `ARKM.DM.Purge` over RCON to every active ARK instance (or the
   * single one identified by `instanceId`).  The plugin then walks
   * ARKM_decay_pending on each contacted server and destroys the
   * corresponding actors.
   */
  runPurge: (instanceId?: number) =>
    api.post<{
      instances_total:  number;
      instances_ok:     number;
      instances_failed: number;
      results:          Array<{
        instance_id:   number;
        instance_name: string | null;
        status:        string;
        exit_code?:    number;
        duration_ms?:  number;
        stdout_tail?:  string;
        stderr_tail?:  string;
        message?:      string;
      }>;
    }>(
      "/arkmania/decay/run-purge",
      null,
      { params: instanceId ? { instance_id: instanceId } : undefined, timeout: 120_000 },
    ),

  /** Schedule a single tribe AND immediately fire DM.Purge cluster-wide. */
  purgeTribe: (targetingTeam: number) =>
    api.post<{
      targeting_team:   number;
      scheduled_on:     string[];
      rows_inserted:    number;
      instances_total:  number;
      instances_ok:     number;
      instances_failed: number;
      results:          Array<{
        instance_id:   number;
        instance_name: string | null;
        status:        string;
        exit_code?:    number;
        message?:      string;
      }>;
    }>(`/arkmania/decay/purge-tribe/${targetingTeam}`, null, { timeout: 120_000 }),
};

// ---------------------------------------------------------------------------
// ArkMania — Bans
// ---------------------------------------------------------------------------

export const arkBansApi = {
  list: (params?: { active_only?: boolean; search?: string; limit?: number }) =>
    api.get("/arkmania/bans", { params }),
  get: (id: number) => api.get(`/arkmania/bans/${id}`),
  create: (data: {
    eos_id: string;
    player_name?: string;
    reason?: string;
    banned_by?: string;
    expire_time?: string;
  }) => api.post("/arkmania/bans", data),
  unban: (id: number, unbannedBy = "Admin") =>
    api.put(`/arkmania/bans/${id}/unban`, null, {
      params: { unbanned_by: unbannedBy },
    }),
};

// ---------------------------------------------------------------------------
// ArkMania — Rare Dinos
// ---------------------------------------------------------------------------

export const arkRareDinosApi = {
  list: (params?: { map_name?: string; enabled_only?: boolean }) =>
    api.get("/arkmania/rare-dinos", { params }),
  create: (data: unknown) => api.post("/arkmania/rare-dinos", data),
  update: (id: number, data: unknown) =>
    api.put(`/arkmania/rare-dinos/${id}`, data),
  delete: (id: number) => api.delete(`/arkmania/rare-dinos/${id}`),
  bulkUpdate: (dinos: unknown[], replaceAll = false) =>
    api.post("/arkmania/rare-dinos/bulk", dinos, {
      params: { replace_all: replaceAll },
    }),
  spawns: (params?: {
    limit?: number;
    event_type?: string;
    server_key?: string;
  }) => api.get("/arkmania/rare-dinos/spawns", { params }),
  /**
   * Truncate the spawn / kill event log table (ARKM_rare_spawns).
   * Does NOT touch the configured rare-dino pool (ARKM_rare_dinos).
   */
  clearSpawns: (params?: { server_key?: string; older_than_days?: number }) =>
    api.delete<{ deleted: number; scope: string }>(
      "/arkmania/rare-dinos/spawns",
      { params },
    ),
  generate: (params: {
    count?: number;
    map_name?: string;
    stat_preset?: string;
    exclude_existing?: boolean;
  }) => api.post<{
    generated: Record<string, unknown>[];
    count: number;
    available_dinos: number;
    excluded_existing: number;
  }>("/arkmania/rare-dinos/generate", params),
};

// ---------------------------------------------------------------------------
// ArkMania — Transfer Rules
// ---------------------------------------------------------------------------

export const arkTransferRulesApi = {
  list: () => api.get("/arkmania/transfer-rules"),
  create: (data: {
    source_server: string;
    dest_server: string;
    transfer_level: number;
    notes?: string;
  }) => api.post("/arkmania/transfer-rules", data),
  update: (id: number, data: { transfer_level?: number; notes?: string }) =>
    api.put(`/arkmania/transfer-rules/${id}`, data),
  delete: (id: number) => api.delete(`/arkmania/transfer-rules/${id}`),
};

// ---------------------------------------------------------------------------
// ArkMania — Leaderboard
// ---------------------------------------------------------------------------

export const arkLeaderboardApi = {
  overview: () => api.get("/arkmania/leaderboard"),
  scores: (params?: {
    server_type?: string;
    sort_by?: string;
    limit?: number;
    offset?: number;
    search?: string;
  }) => api.get("/arkmania/leaderboard/scores", { params }),
  events: (params?: {
    server_type?: string;
    event_type?: number;
    eos_id?: string;
    limit?: number;
  }) => api.get("/arkmania/leaderboard/events", { params }),
  player: (eosId: string) => api.get(`/arkmania/leaderboard/player/${eosId}`),
  /**
   * Truncate the leaderboard tables (`ARKM_lb_scores` + `ARKM_lb_events`)
   * for a given server_type, or for everything when omitted.
   */
  clear: (server_type?: string) =>
    api.delete<{
      scores_deleted: number;
      events_deleted: number;
      scope:          string;
    }>("/arkmania/leaderboard/scores", {
      params: server_type ? { server_type } : undefined,
    }),
};

// ---------------------------------------------------------------------------
// Game config (INI editor)
// ---------------------------------------------------------------------------

export const gameConfigApi = {
  getDefinitions: () => api.get("/game-config/definitions"),
  loadConfig: (machineId: number, containerName: string) =>
    api.get(
      `/game-config/machines/${machineId}/containers/${containerName}/config`,
      { timeout: 60_000 }
    ),
  saveConfig: (machineId: number, containerName: string, data: unknown) =>
    api.post(
      `/game-config/machines/${machineId}/containers/${containerName}/config`,
      data
    ),
  saveRaw: (machineId: number, containerName: string, data: unknown) =>
    api.post(
      `/game-config/machines/${machineId}/containers/${containerName}/config/raw`,
      data
    ),
  saveStacks: (machineId: number, containerName: string, data: unknown) =>
    api.post(
      `/game-config/machines/${machineId}/containers/${containerName}/config/stacks`,
      data
    ),
  saveCrafting: (machineId: number, containerName: string, data: unknown) =>
    api.post(
      `/game-config/machines/${machineId}/containers/${containerName}/config/crafting`,
      data
    ),
  saveNpcReplacements: (machineId: number, containerName: string, data: unknown) =>
    api.post(
      `/game-config/machines/${machineId}/containers/${containerName}/config/npc-replacements`,
      data
    ),
  saveOverrideRaw: (machineId: number, containerName: string, data: unknown) =>
    api.post(
      `/game-config/machines/${machineId}/containers/${containerName}/config/override-raw`,
      data
    ),
};

// ---------------------------------------------------------------------------
// Discord (admin only — Phase 3)
// ---------------------------------------------------------------------------
//
// Mirrors `backend/app/api/routes/discord.py`.  All endpoints are gated by
// `Depends(require_admin)` server-side; the sidebar already hides the page
// for non-admin operators so the UI never reaches these calls.

/** /api/v1/discord/config response. */
export interface DiscordConfigStatus {
  client_id:           string;
  public_key:          string;
  guild_id:            string;
  redirect_uri:        string;
  has_client_secret:   boolean;
  has_bot_token:       boolean;
  oauth_ready:         boolean;
  bot_ready:           boolean;
  missing_for_oauth:   string[];
  missing_for_bot:     string[];
  admin_user_ids:      string[];
  operator_user_ids:   string[];
  viewer_user_ids:     string[];
}

/** Single row from /api/v1/discord/accounts. */
export interface DiscordAccount {
  discord_user_id:     string;
  discord_username:    string | null;
  discord_global_name: string | null;
  discord_avatar:      string | null;
  eos_id:              string | null;
  app_user_id:         number | null;
  app_user_username:   string | null;
  app_user_role:       string | null;
  linked_at:           string | null;
  last_sync_at:        string | null;
}

/** Single hit from /api/v1/discord/players/search?q= */
export interface DiscordPlayerSearchHit {
  eos_id:     string;
  name:       string | null;
  tribe_name: string | null;
}

export interface DiscordGuildInfo {
  id:                          string;
  name:                        string;
  icon:                        string | null;
  owner_id:                    string | null;
  approximate_member_count:    number | null;
  approximate_presence_count:  number | null;
}

export interface DiscordGuildRole {
  id:          string;
  name:        string;
  color:       number;
  position:    number;
  hoist:       boolean;
  managed:     boolean;
  mentionable: boolean;
}

export interface DiscordGuildMember {
  user_id:     string;
  username:    string | null;
  global_name: string | null;
  avatar:      string | null;
  nick:        string | null;
  roles:       string[];
  joined_at:   string | null;
}

export const discordApi = {
  // -- Diagnostic + accounts --------------------------------------------------
  config:   () => api.get<DiscordConfigStatus>("/discord/config"),
  accounts: () => api.get<DiscordAccount[]>("/discord/accounts"),

  // -- Player search + EOS link ----------------------------------------------
  searchPlayers: (q: string, limit = 25) =>
    api.get<DiscordPlayerSearchHit[]>("/discord/players/search", {
      params: { q, limit },
    }),
  linkEos: (discord_user_id: string, eos_id: string) =>
    api.post<DiscordAccount>(
      `/discord/link-eos/${discord_user_id}`,
      { eos_id },
    ),
  unlinkEos: (discord_user_id: string) =>
    api.delete<DiscordAccount>(`/discord/link-eos/${discord_user_id}`),

  // -- AppUser link (already shipped in Phase 2; surfaced here for the UI) ---
  linkAppUser: (
    discord_user_id: string,
    body: { app_user_id?: number; app_user_username?: string },
  ) => api.post<DiscordAccount>(`/discord/link-app-user/${discord_user_id}`, body),
  unlinkAppUser: (discord_user_id: string) =>
    api.delete<DiscordAccount>(`/discord/link-app-user/${discord_user_id}`),

  // -- Bot guild operations --------------------------------------------------
  guildInfo:    () => api.get<DiscordGuildInfo>("/discord/guild/info"),
  guildRoles:   () => api.get<DiscordGuildRole[]>("/discord/guild/roles"),
  guildMembers: (params?: { limit?: number; after?: string }) =>
    api.get<DiscordGuildMember[]>("/discord/guild/members", { params }),

  assignRole: (user_id: string, role_id: string) =>
    api.put(`/discord/guild/members/${user_id}/roles/${role_id}`),
  removeRole: (user_id: string, role_id: string) =>
    api.delete(`/discord/guild/members/${user_id}/roles/${role_id}`),

  kickMember: (user_id: string) =>
    api.delete(`/discord/guild/members/${user_id}`),
  banMember:  (
    user_id: string,
    body: { reason?: string; delete_message_seconds?: number } = {},
  ) => api.put(`/discord/guild/bans/${user_id}`, body),
  unbanMember: (user_id: string) =>
    api.delete(`/discord/guild/bans/${user_id}`),

  dmUser: (user_id: string, content: string) =>
    api.post<{ channel_id: string; message_id: string | null }>(
      `/discord/dm/${user_id}`,
      { content },
    ),
};

// ---------------------------------------------------------------------------
// SQL Console (admin only)
// ---------------------------------------------------------------------------

export type SqlDatabaseTarget = "panel" | "plugin";

/** Direct SQL query execution against one of the configured MariaDB databases. */
export const sqlConsoleApi = {
  /** Execute an arbitrary SQL query (SELECT, INSERT, UPDATE, DDL, etc.). */
  execute: (query: string, database: SqlDatabaseTarget = "panel") =>
    api.post("/sql/execute", { query, database }),

  /** List all tables in the target database with size information. */
  tables: (database: SqlDatabaseTarget = "panel") =>
    api.get("/sql/tables", { params: { database } }),

  /** Return column-level metadata for a specific table. */
  tableSchema: (tableName: string, database: SqlDatabaseTarget = "panel") =>
    api.get(`/sql/tables/${tableName}/schema`, { params: { database } }),
};

export default api;
