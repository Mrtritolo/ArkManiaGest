/**
 * types/index.ts — Shared TypeScript type definitions for ArkManiaGest.
 *
 * This file mirrors the Pydantic schemas in the FastAPI backend.
 * Keep the two in sync whenever the API contract changes.
 */

// ---------------------------------------------------------------------------
// App settings
// ---------------------------------------------------------------------------

export interface AppSettings {
  app_name: string;
  version: string;
  log_level: string;
  auto_backup: boolean;
  backup_interval_hours: number;
  backup_retention: number;
}

export interface AppSettingsUpdate {
  app_name?: string;
  log_level?: string;
  auto_backup?: boolean;
  backup_interval_hours?: number;
  backup_retention?: number;
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

export interface DatabaseConfig {
  host: string;
  port: number;
  name: string;
  user: string;
  /** True when a password is configured in .env (actual value is never exposed). */
  has_password: boolean;
}

export interface DualDatabaseConfig {
  panel: DatabaseConfig;
  plugin: DatabaseConfig;
  /** True when panel and plugin point at different host+db pairs. */
  plugin_is_separate: boolean;
  /** True when PLUGIN_DB_* is explicitly set in .env (not inheriting from panel). */
  plugin_configured: boolean;
}

export interface VersionCheckResult {
  current: string;
  current_commit: string | null;
  current_built_at: string | null;
  latest: string | null;
  update_available: boolean;
  release_url: string | null;
  release_name: string | null;
  release_published_at: string | null;
  release_notes: string | null;
  cached_at: string | null;
  error: string | null;
}

export interface DatabaseTestRequest {
  host: string;
  port: number;
  name: string;
  user: string;
  password: string;
}

export interface DatabaseTestResult {
  success: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// SSH machines
// ---------------------------------------------------------------------------

export type AuthMethod = "password" | "key" | "key_password";

export type OSType = "linux" | "windows";

export interface SSHMachine {
  id: number;
  name: string;
  description: string | null;
  hostname: string;
  ip_address: string | null;
  ssh_port: number;
  ssh_user: string;
  auth_method: AuthMethod;
  ssh_key_path: string | null;
  ark_root_path: string;
  ark_config_path: string;
  ark_plugins_path: string;
  os_type: OSType;
  wsl_distro: string | null;
  is_active: boolean;
  last_connection: string | null;
  last_status: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface SSHMachineCreate {
  name: string;
  description?: string;
  hostname: string;
  ip_address?: string;
  ssh_port: number;
  ssh_user: string;
  auth_method: AuthMethod;
  ssh_password?: string;
  ssh_key_path?: string;
  ssh_passphrase?: string;
  ark_root_path: string;
  ark_config_path: string;
  ark_plugins_path: string;
  os_type: OSType;
  wsl_distro?: string;
  is_active: boolean;
}

/** All fields optional for partial updates. */
export interface SSHMachineUpdate extends Partial<SSHMachineCreate> {}

export interface SSHTestResult {
  success: boolean;
  message: string;
  hostname: string;
  response_time_ms: number | null;
}

// ---------------------------------------------------------------------------
// ServerForge
// ---------------------------------------------------------------------------

export interface SFMachine {
  id: number;
  hostname: string | null;
  ip_address: string | null;
  status: string;
  os: string;
  cpu_usage_percent: string | null;
  ram_usage_percent: string | null;
  ram_total_gb: string | null;
  ram_used_gb: string | null;
  disk_usage_percent: string | null;
  disk_total_gb: string | null;
  disk_used_gb: string | null;
  location: string;
  containers_count: number;
  clusters_count: number;
  is_owner: boolean;
}

export interface SFContainer {
  id: number;
  label: string | null;
  container_name: string;
  status: string;
  server_port: number | null;
  rcon_port: number | null;
  max_players: number | null;
  map_name: string | null;
  uptime: number;
  formatted_uptime: string;
  build_id: number | null;
  update_available: boolean;
  auto_update: boolean;
  machine: { id: number; hostname: string; ip_address: string } | null;
  game: { id: number; name: string } | null;
  cluster: { id: number; name: string } | null;
  owner: { id: number; name: string } | null;
  current_live_stats: unknown | null;
  is_owner: boolean;
  permissions: string[];
}

export interface SFCluster {
  id: number;
  name: string;
  cluster_id: string | null;
  sync_enabled: boolean;
  machine: { id: number; hostname: string; ip_address: string } | null;
  containers_count: number;
  sync_members_count: number;
}

export interface SFImportPreview {
  sf_id: number;
  hostname: string;
  ip_address: string;
  status: string;
  os: string;
  location: string;
  ssh_port: number;
  containers_count: number;
  clusters_count: number;
  already_imported: boolean;
}

export interface SFImportRequest {
  sf_machine_id: number;
  name: string;
  hostname: string;
  ip_address?: string;
  ssh_port: number;
  ssh_user: string;
  auth_method: string;
  ssh_password?: string;
  ssh_key_path?: string;
  ark_root_path: string;
  ark_config_path: string;
  ark_plugins_path: string;
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

export interface PlayerListItem {
  id: number;
  eos_id: string;
  name: string | null;
  permission_groups: string;
  timed_permission_groups: string;
  points: number | null;
  total_spent: number | null;
  tribe_name: string | null;
  last_login: string | null;
}

export interface PlayerFull {
  id: number;
  eos_id: string;
  name: string | null;
  permission_groups: string;
  timed_permission_groups: string;
  points: number | null;
  total_spent: number | null;
  kits: string | null;
  tribe_name: string | null;
  tribe_id: number | null;
  last_login: string | null;
}

export interface PlayersStats {
  total_players: number;
  players_with_points: number;
  total_points_in_circulation: number;
  total_spent: number;
  permission_groups_count: number;
}

export interface PlayerMapResult {
  machine_id: number;
  machine_name: string;
  hostname: string;
  container_name: string;
  map_name: string;
  map_path: string;
  profile_path: string;
  file_id: string;
  player_name: string | null;
}

export interface PlayerMapSearchResponse {
  eos_id: string;
  maps: PlayerMapResult[];
  total: number;
  errors: string[];
}

export interface CopyCharacterRequest {
  source_machine_id: number;
  source_container: string;
  source_profile_path: string;
  dest_machine_id: number;
  dest_container: string;
  dest_map_name: string;
  backup?: boolean;
}

export interface CopyCharacterResponse {
  success: boolean;
  source_path: string;
  filename: string;
  dest_path: string;
  backup_path: string | null;
  overwritten: boolean;
  size: number;
}

export interface PermissionGroupItem {
  id: number;
  group_name: string;
  permissions: string;
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

export type UserRole = "admin" | "operator" | "viewer";

export interface AuthUser {
  id: number;
  username: string;
  display_name: string;
  role: UserRole;
  active: boolean;
  created_at: string | null;
  last_login: string | null;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}

// ---------------------------------------------------------------------------
// Server instances (ARK game servers managed via POK-manager in Docker)
// ---------------------------------------------------------------------------

export type InstanceStatus =
  | "created"
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "updating"
  | "error";

export type UpdateCoordinationRole = "MASTER" | "FOLLOWER";

export interface ServerInstance {
  id: number;
  machine_id: number;
  name: string;
  display_name: string;
  description: string | null;

  map_name: string;
  session_name: string;
  max_players: number;
  cluster_id: string | null;
  mods: string | null;
  passive_mods: string | null;
  custom_args: string | null;

  game_port: number;
  rcon_port: number;

  container_name: string;
  image: string;
  mem_limit_mb: number;
  timezone: string;

  pok_base_dir: string;
  instance_dir: string;

  mod_api: boolean;
  battleye: boolean;
  update_server: boolean;
  update_coordination_role: UpdateCoordinationRole;
  update_coordination_priority: number;
  cpu_optimization: boolean;

  is_active: boolean;
  status: InstanceStatus;
  last_status_at: string | null;
  last_started_at: string | null;
  last_stopped_at: string | null;
  created_at: string | null;
  updated_at: string | null;

  has_admin_password: boolean;
  has_server_password: boolean;
}

export interface ServerInstanceCreate {
  machine_id: number;
  name: string;
  display_name?: string;
  description?: string | null;

  map_name?: string;
  session_name?: string;
  max_players?: number;
  cluster_id?: string | null;
  mods?: string | null;
  passive_mods?: string | null;
  custom_args?: string | null;

  admin_password: string;
  server_password?: string | null;

  game_port?: number;
  rcon_port?: number;

  image?: string;
  mem_limit_mb?: number;
  timezone?: string;

  mod_api?: boolean;
  battleye?: boolean;
  update_server?: boolean;
  update_coordination_role?: UpdateCoordinationRole;
  update_coordination_priority?: number;
  cpu_optimization?: boolean;

  pok_base_dir?: string | null;
}

export interface ServerInstanceUpdate extends Partial<Omit<ServerInstanceCreate, "machine_id" | "name">> {
  is_active?: boolean;
}

// Response shape of any lifecycle action endpoint (/start, /stop, ...).
export interface InstanceActionResult {
  instance_id: number;
  action_id: number;
  status: "success" | "failed";
  exit_code: number;
  duration_ms: number;
  stdout_tail: string;
  stderr_tail: string;
}

// ---------------------------------------------------------------------------
// Instance action audit log
// ---------------------------------------------------------------------------

export type InstanceActionKind =
  | "bootstrap"
  | "create"
  | "start"
  | "stop"
  | "restart"
  | "update"
  | "backup"
  | "delete"
  | "rcon"
  | "pok_sync"
  | "prereqs_check";

export type InstanceActionStatus = "pending" | "running" | "success" | "failed";

export interface InstanceAction {
  id: number;
  instance_id: number | null;
  machine_id: number | null;
  instance_name: string | null;

  action: InstanceActionKind;
  status: InstanceActionStatus;

  stdout: string | null;
  stderr: string | null;
  exit_code: number | null;
  meta: string | null;

  user_id: number | null;
  username: string | null;

  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
}
