/**
 * instanceModel.ts -- pure helpers shared by the ServerInstances shell, its
 * hooks and its section components. No React, no API calls.
 */
import type { RuntimeStatus } from "../../components/ui";
import type {
  DiscoveredContainer,
  InstanceStatus,
  ServerInstance,
  ServerInstanceCreate,
  ServerInstanceUpdate,
} from "../../types";

/** Every lifecycle call the page can dispatch. */
export type LifecycleAction =
  | "start" | "stop" | "restart" | "update" | "backup" | "probe" | "provision";

/** Actions the card toolbar dispatches directly (update goes through a confirm). */
export type CardAction = Exclude<LifecycleAction, "update">;

export const emptyForm: ServerInstanceCreate = {
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

export interface ImportFormState {
  display_name: string;
  map_name: string;
  game_port: number;
  rcon_port: number;
  admin_password: string;
  server_password: string;
}

export function emptyImportForm(c: DiscoveredContainer): ImportFormState {
  return {
    display_name: c.server_name || c.name,
    map_name: c.map_name || "TheIsland_WP",
    game_port: 7777,
    rcon_port: 27020,
    admin_password: "",
    server_password: "",
  };
}

/**
 * Raw instance status -> the kit's RuntimeStatus. The visible word still comes
 * from `instances.status.*`, so the eight backend states stay distinguishable.
 */
export function instanceRuntimeStatus(status: InstanceStatus): RuntimeStatus {
  switch (status) {
    case "running":
      return "online";
    case "error":
    case "missing":
      return "error";
    case "starting":
      return "testing";
    case "updating":
      return "updating";
    default:
      // created, stopped, stopping
      return "offline";
  }
}

/** Audit-log row status -> Badge tone. */
export function actionLogTone(status: string): "success" | "danger" | "neutral" {
  if (status === "success") return "success";
  if (status === "failed") return "danger";
  return "neutral";
}

/** The edit form, prefilled from a saved instance. Passwords are never read back. */
export function instanceToForm(inst: ServerInstance): ServerInstanceCreate {
  return {
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
    image: inst.image ?? undefined,
    mem_limit_mb: inst.mem_limit_mb,
    timezone: inst.timezone,
    mod_api: inst.mod_api,
    battleye: inst.battleye,
    update_server: inst.update_server,
    update_coordination_role: inst.update_coordination_role,
    update_coordination_priority: inst.update_coordination_priority,
    cpu_optimization: inst.cpu_optimization,
    pok_base_dir: inst.pok_base_dir,
  };
}

/**
 * The PUT body. `pok_base_dir` and `name` are not updatable, and the two
 * passwords are only sent when they carry an intent: a blank admin password
 * keeps the stored one, while an explicit empty server password clears it
 * (servers.py maps "" to NULL).
 */
export function toUpdatePayload(
  form: ServerInstanceCreate,
  clearServerPassword: boolean,
): ServerInstanceUpdate {
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
  if (clearServerPassword) payload.server_password = "";
  else if (form.server_password) payload.server_password = form.server_password;
  return payload;
}

/**
 * Fields servers.py rejects with 422 when they contain a double quote (they
 * end up inside a quoted argument of the start command). Blocking it here
 * turns a server-side 422 into an inline field error.
 */
export const QUOTED_FIELDS = [
  "map_name",
  "session_name",
  "admin_password",
  "server_password",
] as const;

export type QuotedField = (typeof QUOTED_FIELDS)[number];

/** Which of the quote-sensitive fields currently hold a double quote. */
export function quoteErrors(form: {
  map_name?: string | null;
  session_name?: string | null;
  admin_password?: string | null;
  server_password?: string | null;
}): QuotedField[] {
  return QUOTED_FIELDS.filter(key => (form[key] ?? "").includes('"'));
}
