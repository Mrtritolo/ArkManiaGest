/**
 * Sidebar.tsx — Main navigation sidebar.
 *
 * Renders three navigation groups (Main, Plugins, Settings) using NavLink
 * for active-state highlighting, and a footer section with the current user's
 * avatar, role badge, language toggle, and logout button.
 *
 * Admin-only items (e.g. Users, General Settings, Database, SQL Console) are
 * filtered out for non-admin users so the routes simply do not appear in the UI.
 */

import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
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
  Globe,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AuthUser } from "../types";
import {
  SUPPORTED_LANGUAGES,
  LANGUAGE_LABELS,
  setLanguage,
  getCurrentLanguage,
  type SupportedLanguage,
} from "../i18n";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SidebarProps {
  currentUser?: AuthUser | null;
  onLogout?: () => void;
}

interface NavItem {
  to: string;
  /** i18n key for the label (e.g. "nav.dashboard"). */
  i18nKey: string;
  icon: LucideIcon;
  /** When true the item is only shown to users with the "admin" role. */
  adminOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Navigation data
// ---------------------------------------------------------------------------

const NAV_MAIN: NavItem[] = [
  { to: "/",                i18nKey: "nav.dashboard",  icon: LayoutDashboard },
  { to: "/serverforge",     i18nKey: "nav.serverForge", icon: Server },
  { to: "/online",          i18nKey: "nav.online",     icon: Users },
  { to: "/players",         i18nKey: "nav.players",    icon: Database },
  { to: "/containers",      i18nKey: "nav.containers", icon: HardDrive },
  { to: "/instances",       i18nKey: "nav.instances",  icon: Server },
  { to: "/game-config",     i18nKey: "nav.gameConfig", icon: Sliders },
  { to: "/servers-manager", i18nKey: "nav.servers",    icon: Server },
  { to: "/event-log",       i18nKey: "nav.eventLog",   icon: ScrollText },
];

const NAV_PLUGINS: NavItem[] = [
  { to: "/plugins/arkshop",        i18nKey: "nav.arkshop",         icon: ShoppingBag },
  { to: "/plugins/config",         i18nKey: "nav.arkmaniaConfig",  icon: Sliders },
  { to: "/plugins/bans",           i18nKey: "nav.bans",            icon: Ban },
  { to: "/plugins/rare-dinos",     i18nKey: "nav.rareDinos",       icon: Eye },
  { to: "/plugins/transfer-rules", i18nKey: "nav.transferRules",   icon: ArrowRightLeft },
  { to: "/plugins/decay",          i18nKey: "nav.decay",           icon: Timer },
  { to: "/plugins/leaderboard",    i18nKey: "nav.leaderboard",     icon: Trophy },
];

const NAV_SETTINGS: NavItem[] = [
  { to: "/settings/users",      i18nKey: "nav.users",      icon: UserCog,  adminOnly: true },
  { to: "/settings/db",         i18nKey: "nav.database",   icon: Database, adminOnly: true },
  { to: "/settings/sql",        i18nKey: "nav.sqlConsole", icon: Terminal, adminOnly: true },
  { to: "/settings/machines",   i18nKey: "nav.machines",   icon: Monitor },
  { to: "/settings/blueprints", i18nKey: "nav.blueprints", icon: BookOpen },
  { to: "/settings/general",    i18nKey: "nav.settings",   icon: Settings, adminOnly: true },
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
  const { t, i18n } = useTranslation();
  const role = currentUser?.role ?? "viewer";
  const currentLang = getCurrentLanguage();

  /** Build the active-state class string for NavLink. */
  function navClass({ isActive }: { isActive: boolean }): string {
    return `sidebar-link${isActive ? " sidebar-link-active" : ""}`;
  }

  function handleLanguageChange(e: React.ChangeEvent<HTMLSelectElement>): void {
    const next = e.target.value as SupportedLanguage;
    setLanguage(next);
    // useTranslation re-renders consumers automatically when i18n.language changes.
    void i18n;
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
            {t(item.i18nKey)}
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
            {t(item.i18nKey)}
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
            {t(item.i18nKey)}
          </NavLink>
        ))}
      </nav>

      {/* Footer: user info + language toggle + logout */}
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

        <div
          className="sidebar-actions"
          style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
        >
          {/* Language toggle */}
          <label
            className="sidebar-lang"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
              fontSize: "0.78rem",
              color: "var(--text-muted)",
            }}
            title={t("common.language")}
          >
            <Globe size={13} />
            <select
              value={currentLang}
              onChange={handleLanguageChange}
              style={{
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm, 4px)",
                color: "var(--text-primary)",
                padding: "0.15rem 0.35rem",
                fontSize: "0.78rem",
                cursor: "pointer",
              }}
              aria-label={t("common.language")}
            >
              {SUPPORTED_LANGUAGES.map((code) => (
                <option key={code} value={code}>
                  {LANGUAGE_LABELS[code]}
                </option>
              ))}
            </select>
          </label>

          {onLogout && (
            <button
              onClick={onLogout}
              className="sidebar-lock-btn"
              title={t("auth.logout")}
            >
              <LogOut size={14} /> {t("auth.logout")}
            </button>
          )}
        </div>

        <span className="sidebar-version">V 2.3.4</span>
      </div>
    </aside>
  );
}
