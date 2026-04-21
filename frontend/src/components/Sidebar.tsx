/**
 * Sidebar.tsx — Main navigation sidebar.
 *
 * Renders three navigation groups (Main, Plugins, Settings) using NavLink
 * for active-state highlighting, and a footer section with the current user's
 * avatar, role badge, and logout button.
 *
 * Admin-only items (e.g. Users, General Settings, Database, SQL Console) are
 * filtered out for non-admin users so the routes simply do not appear in the UI.
 */

import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Server,
  Users,
  Database,
  HardDrive,
  Monitor,
  Settings,
  ShoppingBag,
  BookOpen,
  LogOut,
  Shield,
  UserCog,
  Eye,
  Sliders,
  Ban,
  ArrowRightLeft,
  Timer,
  Trophy,
  Terminal,
  ScrollText,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AuthUser } from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SidebarProps {
  currentUser?: AuthUser | null;
  onLogout?: () => void;
}

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** When true the item is only shown to users with the "admin" role. */
  adminOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Navigation data
// ---------------------------------------------------------------------------

const NAV_MAIN: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/serverforge", label: "ServerForge", icon: Server },
  { to: "/online", label: "Online", icon: Users },
  { to: "/players", label: "Players", icon: Database },
  { to: "/containers", label: "Containers", icon: HardDrive },
  { to: "/game-config", label: "Config Editor", icon: Sliders },
  { to: "/servers-manager", label: "Server Manager", icon: Server },
  { to: "/event-log", label: "Event Log", icon: ScrollText },
];

const NAV_PLUGINS: NavItem[] = [
  { to: "/plugins/arkshop", label: "ArkShop", icon: ShoppingBag },
  { to: "/plugins/config", label: "Plugin Config", icon: Sliders },
  { to: "/plugins/bans", label: "Ban Manager", icon: Ban },
  { to: "/plugins/rare-dinos", label: "Rare Dinos", icon: Eye },
  { to: "/plugins/transfer-rules", label: "Transfer Rules", icon: ArrowRightLeft },
  { to: "/plugins/decay", label: "Decay", icon: Timer },
  { to: "/plugins/leaderboard", label: "Leaderboard", icon: Trophy },
];

const NAV_SETTINGS: NavItem[] = [
  { to: "/settings/users", label: "Users", icon: UserCog, adminOnly: true },
  { to: "/settings/db", label: "Database", icon: Database, adminOnly: true },
  { to: "/settings/sql", label: "SQL Console", icon: Terminal, adminOnly: true },
  { to: "/settings/machines", label: "SSH Machines", icon: Monitor },
  { to: "/settings/blueprints", label: "Blueprint DB", icon: BookOpen },
  {
    to: "/settings/general",
    label: "General",
    icon: Settings,
    adminOnly: true,
  },
];

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrator",
  operator: "Operator",
  viewer: "Viewer",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Sidebar({ currentUser, onLogout }: SidebarProps) {
  const role = currentUser?.role ?? "viewer";

  /** Build the active-state class string for NavLink. */
  function navClass({ isActive }: { isActive: boolean }): string {
    return `sidebar-link${isActive ? " sidebar-link-active" : ""}`;
  }

  return (
    <aside className="sidebar">
      {/* Brand / logo */}
      <div className="sidebar-brand">
        <img src="/logo.png" alt="ArkMania" className="sidebar-brand-logo" />
        <div>
          <h1 className="sidebar-brand-title">ArkManiaGest</h1>
          <span className="sidebar-brand-sub">Ark: Survival Ascended</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        {/* Main section */}
        <span className="sidebar-section-label">Main</span>
        {NAV_MAIN.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={navClass}
          >
            <item.icon size={17} className="sidebar-link-svg" />
            {item.label}
          </NavLink>
        ))}

        {/* Plugins section */}
        <span
          className="sidebar-section-label"
          style={{ marginTop: "0.75rem" }}
        >
          Plugins
        </span>
        {NAV_PLUGINS.map((item) => (
          <NavLink key={item.to} to={item.to} className={navClass}>
            <item.icon size={17} className="sidebar-link-svg" />
            {item.label}
          </NavLink>
        ))}

        {/* Settings section */}
        <span
          className="sidebar-section-label"
          style={{ marginTop: "0.75rem" }}
        >
          Settings
        </span>
        {NAV_SETTINGS.filter(
          (item) => !item.adminOnly || role === "admin"
        ).map((item) => (
          <NavLink key={item.to} to={item.to} className={navClass}>
            <item.icon size={17} className="sidebar-link-svg" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* Footer: user info + logout */}
      <div className="sidebar-footer">
        {currentUser && (
          <div className="sidebar-user">
            <div className="sidebar-user-avatar">
              {currentUser.display_name[0].toUpperCase()}
            </div>
            <div className="sidebar-user-info">
              <span className="sidebar-user-name">
                {currentUser.display_name}
              </span>
              <span className="sidebar-user-role">
                <Shield size={9} />
                {" "}
                {ROLE_LABELS[currentUser.role] ?? currentUser.role}
              </span>
            </div>
          </div>
        )}

        <div className="sidebar-actions">
          {onLogout && (
            <button
              onClick={onLogout}
              className="sidebar-lock-btn"
              title="Sign out of your account"
            >
              <LogOut size={14} /> Logout
            </button>
          )}
        </div>

        <span className="sidebar-version">V 2.2.2</span>
      </div>
    </aside>
  );
}
