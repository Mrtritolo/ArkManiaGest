/**
 * Sidebar.tsx — the navigation panel.
 *
 * Rendered twice by the shell (App.tsx): inside the sticky 240px column at
 * 900px and up, and inside the mobile drawer below it.  The drawer passes
 * `onClose` (which adds the visible close button) and `onNavigate` (which
 * closes the drawer when an entry is followed); the desktop column passes
 * neither.  The panel itself is never the dialog — App wraps it.
 *
 * Because there are two instances, the panel holds no theme state of its
 * own: `theme.ts` broadcasts no DOM event, so a per-instance mirror would
 * go stale in the copy that did not handle the click.  The shell owns the
 * single mirror and passes it down with `onToggleTheme`.
 *
 * Admin-only entries (Users, General settings, Database, SQL console, Discord,
 * Audit log) are filtered out for non-admin users, matching the routes App.tsx
 * mounts for them.
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
  ShieldCheck,
  UserCog,
  Eye,
  Sliders,
  Ban,
  ArrowRightLeft,
  Timer,
  Trophy,
  Terminal,
  Network,
  ScrollText,
  Sun,
  Moon,
  X,
  User,
  Crosshair,
} from "lucide-react";
import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import type { AuthUser, UserRole } from "../types";
import {
  SUPPORTED_LANGUAGES,
  LANGUAGE_LABELS,
  setLanguage,
  getCurrentLanguage,
  type SupportedLanguage,
} from "../i18n";
import type { Theme } from "../theme";
import { Avatar, Badge, Button, IconButton, Select } from "./ui";
import DiscordIcon from "./DiscordIcon";
import styles from "./Sidebar.module.css";

// Navigation icons are either a Lucide icon or our inline DiscordIcon; both
// take {size, className} and both are decorative next to their label. The
// union keeps both assignable without a runtime check.
type NavIcon = LucideIcon | ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean }>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SidebarProps {
  currentUser?: AuthUser | null;
  onLogout?: () => void;
  /** Active theme, owned by the shell so both instances agree. */
  theme: Theme;
  /** Flip the theme; the shell re-renders every instance. */
  onToggleTheme: () => void;
  /** Drawer only: called after an entry is followed, so the drawer closes. */
  onNavigate?: () => void;
  /** Drawer only: renders the visible close button. */
  onClose?: () => void;
  /** Drawer only: lets the shell move the opening focus onto the close button. */
  closeButtonRef?: React.RefObject<HTMLButtonElement>;
}

interface NavItem {
  to: string;
  /** i18n key for the label (e.g. "nav.dashboard"). */
  i18nKey: string;
  icon: NavIcon;
  /** When true the item is only shown to users with the "admin" role. */
  adminOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Navigation data
// ---------------------------------------------------------------------------

// "Containers" is no longer surfaced in the sidebar -- the Instances page
// merges container discovery + import into a single workflow.  The
// /containers route still resolves (back-compat for bookmarks and the
// in-page file editor) via a Navigate redirect in App.tsx.
const NAV_MAIN: NavItem[] = [
  { to: "/",                i18nKey: "nav.dashboard",   icon: LayoutDashboard },
  // 'My dashboard' opens the player view inside the admin layout.  Visible
  // for everyone -- the page itself returns a friendly 'no Discord linked'
  // hint when the operator's Discord identity is not bound to an EOS, so
  // the entry is safe even for admins who never linked.
  { to: "/me",              i18nKey: "nav.myDashboard", icon: User },
  { to: "/market",          i18nKey: "nav.market",      icon: ShoppingBag },
  { to: "/serverforge",     i18nKey: "nav.serverForge", icon: Server },
  { to: "/online",          i18nKey: "nav.online",      icon: Users },
  { to: "/players",         i18nKey: "nav.players",     icon: Database },
  { to: "/instances",       i18nKey: "nav.instances",   icon: HardDrive },
  { to: "/game-config",     i18nKey: "nav.gameConfig",  icon: Sliders },
  { to: "/servers-manager", i18nKey: "nav.servers",     icon: Server },
  { to: "/cluster-sync",    i18nKey: "nav.clusterSync", icon: Network },
  { to: "/event-log",       i18nKey: "nav.eventLog",    icon: ScrollText },
];

const NAV_PLUGINS: NavItem[] = [
  { to: "/plugins/arkshop",        i18nKey: "nav.arkshop",        icon: ShoppingBag },
  { to: "/plugins/config",         i18nKey: "nav.arkmaniaConfig", icon: Sliders },
  { to: "/plugins/bans",           i18nKey: "nav.bans",           icon: Ban },
  { to: "/plugins/rare-dinos",     i18nKey: "nav.rareDinos",      icon: Eye },
  { to: "/plugins/transfer-rules", i18nKey: "nav.transferRules",  icon: ArrowRightLeft },
  { to: "/plugins/decay",          i18nKey: "nav.decay",          icon: Timer },
  { to: "/plugins/player-map",     i18nKey: "nav.playerMap",      icon: Crosshair },
  { to: "/plugins/leaderboard",    i18nKey: "nav.leaderboard",    icon: Trophy },
];

const NAV_SETTINGS: NavItem[] = [
  { to: "/settings/users",      i18nKey: "nav.users",      icon: UserCog,     adminOnly: true },
  { to: "/settings/db",         i18nKey: "nav.database",   icon: Database,    adminOnly: true },
  { to: "/settings/sql",        i18nKey: "nav.sqlConsole", icon: Terminal,    adminOnly: true },
  { to: "/settings/discord",    i18nKey: "nav.discord",    icon: DiscordIcon, adminOnly: true },
  { to: "/settings/audit",      i18nKey: "nav.auditLog",   icon: Shield,      adminOnly: true },
  { to: "/settings/machines",   i18nKey: "nav.machines",   icon: Monitor },
  { to: "/settings/hardening",  i18nKey: "nav.hardening",  icon: ShieldCheck },
  { to: "/settings/blueprints", i18nKey: "nav.blueprints", icon: BookOpen },
  { to: "/settings/general",    i18nKey: "nav.settings",   icon: Settings,    adminOnly: true },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Sidebar({
  currentUser,
  onLogout,
  onNavigate,
  onClose,
  closeButtonRef,
  theme,
  onToggleTheme,
}: SidebarProps) {
  const { t, i18n } = useTranslation();
  const role: UserRole = currentUser?.role ?? "viewer";
  const currentLang = getCurrentLanguage();

  function handleLanguageChange(e: React.ChangeEvent<HTMLSelectElement>): void {
    const next = e.target.value as SupportedLanguage;
    setLanguage(next);
    // useTranslation re-renders consumers automatically when i18n.language changes.
    void i18n;
  }

  /** One navigation group: its label plus the entries the role may see. */
  function renderGroup(label: string, items: NavItem[]) {
    const visible = items.filter(item => !item.adminOnly || role === "admin");
    if (visible.length === 0) return null;
    return (
      <>
        <span className="ui-nav-group-label">{label}</span>
        {visible.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className="ui-nav-item"
            onClick={onNavigate}
          >
            <item.icon size={16} aria-hidden />
            {t(item.i18nKey)}
          </NavLink>
        ))}
      </>
    );
  }

  const themeKey = theme === "dark" ? "common.themeLight" : "common.themeDark";

  return (
    <div className={styles.panel}>
      {/* Brand */}
      <div className={styles.brand}>
        <img src="/logo.png" alt="" className={styles.brandLogo} />
        <span className={styles.brandText}>
          <span className={styles.brandTitle}>{t("nav.brand")}</span>
          <span className={styles.brandSub}>{t("nav.brandSub")}</span>
        </span>
        {onClose && (
          <IconButton
            ref={closeButtonRef}
            className="u-push"
            icon={X}
            label={t("nav.closeMenu")}
            onClick={onClose}
          />
        )}
      </div>

      {/* Navigation */}
      <nav className={styles.nav} aria-label={t("nav.mainNav")}>
        {renderGroup(t("nav.section.main"), NAV_MAIN)}
        {renderGroup(t("nav.section.plugins"), NAV_PLUGINS)}
        {renderGroup(t("nav.section.settings"), NAV_SETTINGS)}
      </nav>

      {/* Footer: user, language, theme, logout, version */}
      <div className={styles.footer}>
        {currentUser && (
          <div className={styles.user}>
            {/* display_name can be empty (the user edit form accepts ""):
                Avatar falls back to the username, then to '?'. */}
            <Avatar name={currentUser.display_name || currentUser.username} size="sm" />
            <span className={styles.userText}>
              <span className={styles.userName}>
                {currentUser.display_name || currentUser.username}
              </span>
              <Badge icon={Shield}>{t(`nav.role.${role}`)}</Badge>
            </span>
          </div>
        )}

        <div className="l-cluster">
          <Select
            size="sm"
            className={styles.lang}
            aria-label={t("common.language")}
            value={currentLang}
            onChange={handleLanguageChange}
          >
            {SUPPORTED_LANGUAGES.map(code => (
              <option key={code} value={code}>
                {LANGUAGE_LABELS[code]}
              </option>
            ))}
          </Select>
          <IconButton
            size="sm"
            icon={theme === "dark" ? Sun : Moon}
            label={t(themeKey)}
            onClick={onToggleTheme}
          />
        </div>

        {onLogout && (
          <Button size="sm" icon={LogOut} onClick={onLogout}>
            {t("auth.logout")}
          </Button>
        )}

        <span className={styles.version}>{t("nav.version", { version: __APP_VERSION__ })}</span>
      </div>
    </div>
  );
}
