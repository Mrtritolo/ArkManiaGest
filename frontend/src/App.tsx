/**
 * App.tsx — Root component and application shell.
 *
 * Auth state machine:
 *   loading → (backend unreachable)              → error
 *           → (no users in DB)                   → setup
 *           → (users exist)                      → login
 *                                                → ready    (admin panel)
 *                                                → player   (Discord-only)
 *
 * Resolution order on boot (and on every checkStatus call):
 *
 *   1. #token=... fragment (Discord OAuth callback)  → store + drop into 2.
 *   2. Panel JWT in sessionStorage                    → authApi.me()
 *                                                       success → "ready"
 *   3. Discord session cookie alone                   → discordAuthApi.me()
 *                                                       success → "player"
 *                                                       (dashboard only)
 *   4. Otherwise                                      → "login".
 *
 * The overlay (setup / login / loading / error) replaces the panel entirely
 * and uses the centred `.ui-auth` layout.  Once the state reaches "ready" the
 * shell below takes over; "player" renders the PlayerDashboardPage with no
 * admin navigation.
 *
 * Shell (MASTER section 4.7): a sticky 240px sidebar at 900px and up, a
 * sticky 56px top bar plus a 280px navigation drawer below it.
 */

import { useState, useEffect, useCallback, useRef, lazy, Suspense, Component } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Menu, RotateCw } from "lucide-react";
import {
  settingsApi,
  authApi,
  discordAuthApi,
  setAuthToken,
  getAuthToken,
  setOnAuthError,
} from "./services/api";
import type { AuthUser } from "./types";

// Layout
import Sidebar from "./components/Sidebar";
// Design-system providers: toasts and confirm dialogs are rendered in
// portals, so they must sit above every route (and inside the router, so a
// confirm description can hold a <Link>).
import { ToastProvider, ConfirmProvider, Alert, Button, IconButton, Spinner } from "./components/ui";
import { useDialogFocus } from "./hooks/useDialogFocus";
import { getCurrentTheme, toggleTheme, type Theme } from "./theme";
import styles from "./App.module.css";

// Auth / setup overlays
import SetupWizard from "./pages/SetupWizard";
import LoginPage from "./pages/LoginPage";

// Public privacy policy (GDPR notice) -- reachable pre-login.
import PrivacyPage from "./pages/PrivacyPage";

// Everything below is loaded on first visit, one chunk per page: the login
// screen and the Discord player surface used to download the whole admin
// panel (SQL console, ArkShop editor, decay map, ...) before first paint.
// The overlays above stay eager because they ARE the first paint.

// Player dashboard (Phase 6) -- shown when the user has a Discord
// session cookie but no panel JWT.
const PlayerDashboardPage = lazy(() => import("./pages/PlayerDashboardPage"));

// Marketplace (Phase 8) -- both Discord-standalone and admin-embedded.
const MarketPage = lazy(() => import("./pages/MarketPage"));

// App pages
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const DatabaseSettingsPage = lazy(() => import("./pages/DatabaseSettingsPage"));
const MachinesPage = lazy(() => import("./pages/MachinesPage"));
const GeneralSettingsPage = lazy(() => import("./pages/GeneralSettingsPage"));
const ServerForgePage = lazy(() => import("./pages/ServerForgePage"));
const ClusterSyncPage = lazy(() => import("./pages/ClusterSyncPage"));
const HardeningPage = lazy(() => import("./pages/HardeningPage"));
const PlayersPage = lazy(() => import("./pages/PlayersPage"));
const ArkShopPage = lazy(() => import("./pages/ArkShopPage"));
const BlueprintsPage = lazy(() => import("./pages/BlueprintsPage"));
const GameConfigPage = lazy(() => import("./pages/GameConfigPage"));
const OnlinePlayersPage = lazy(() => import("./pages/OnlinePlayersPage"));
const ArkManiaConfigPage = lazy(() => import("./pages/ArkManiaConfigPage"));
const BansPage = lazy(() => import("./pages/BansPage"));
const RareDinosPage = lazy(() => import("./pages/RareDinosPage"));
const TransferRulesPage = lazy(() => import("./pages/TransferRulesPage"));
const DecayPage = lazy(() => import("./pages/DecayPage"));
const PlayerMapPage = lazy(() => import("./pages/PlayerMapPage"));
const LeaderboardPage = lazy(() => import("./pages/LeaderboardPage"));
const UsersPage = lazy(() => import("./pages/UsersPage"));
const DiscordSettingsPage = lazy(() => import("./pages/DiscordSettingsPage"));
const SqlConsolePage = lazy(() => import("./pages/SqlConsolePage"));
const ServersPage = lazy(() => import("./pages/ServersPage"));
const ServerInstancesPage = lazy(() => import("./pages/ServerInstancesPage"));
const EventLogPage = lazy(() => import("./pages/EventLogPage"));
const AuditLogPage = lazy(() => import("./pages/AuditLogPage"));

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AuthState = "loading" | "setup" | "login" | "ready" | "player" | "error";

// ---------------------------------------------------------------------------
// Page boundary
// ---------------------------------------------------------------------------

type PageErrorBoundaryProps = {
  resetKey: string;
  fallback: React.ReactNode;
  children: React.ReactNode;
};

/**
 * Catches a page chunk that fails to download (network error, or chunks
 * removed by a panel update) and a page that throws while rendering.
 * Without it React unmounts the whole root and leaves a blank screen.
 * The error clears when `resetKey` (the path) changes, so the sidebar,
 * which sits outside the boundary, can still leave a broken page.
 */
class PageErrorBoundary extends Component<PageErrorBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(prev: PageErrorBoundaryProps) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Suspense for the lazy pages, inside the error boundary above. */
function PageBoundary({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  return (
    <PageErrorBoundary
      resetKey={pathname}
      fallback={
        <div className={styles.boundary}>
          <Alert
            tone="danger"
            title={t("common.pageLoadError")}
            actions={
              <Button size="sm" icon={RotateCw} onClick={() => window.location.reload()}>
                {t("common.retry")}
              </Button>
            }
          />
        </div>
      }
    >
      <Suspense
        fallback={
          <div className={styles.boundary}>
            <Spinner block label={t("common.loading")} />
          </div>
        }
      >
        {children}
      </Suspense>
    </PageErrorBoundary>
  );
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

interface ShellProps {
  currentUser: AuthUser | null;
  onLogout: () => void;
}

/**
 * The authenticated panel: navigation plus the route tree.
 *
 * Below 900px the navigation lives in a drawer, which is a dialog WRAPPING
 * the <nav> (the landmark is never replaced by role="dialog"); useDialogFocus
 * gives it Escape, an inert background, the scroll lock and focus restored to
 * the menu button.
 *
 * The shell also owns the active-theme mirror.  `theme.ts` writes
 * <html data-theme> and broadcasts nothing, so the two Sidebar instances
 * cannot each keep their own copy -- the one that did not handle the click
 * would keep showing the wrong icon.  One piece of state here drives both.
 */
function AppShell({ currentUser, onLogout }: ShellProps) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  // The drawer opens on its close button. Without this the hook picks the
  // first form control, which is the language select at the very bottom, so
  // the drawer opened scrolled past every navigation entry.
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const { panelProps } = useDialogFocus(menuOpen, {
    onClose: closeMenu,
    rootRef: drawerRef,
    initialFocusRef: drawerCloseRef,
  });
  const firstRoute = useRef(true);
  const [theme, setTheme] = useState<Theme>(getCurrentTheme);
  const handleToggleTheme = useCallback(() => setTheme(toggleTheme()), []);

  // Route change: close the drawer and hand focus to the new page. The
  // timeout lets the drawer's own focus restore (it runs in the commit that
  // unmounts it) finish first, so the content wins the last word.
  useEffect(() => {
    if (firstRoute.current) {
      firstRoute.current = false;
      return;
    }
    setMenuOpen(false);
    const id = window.setTimeout(() => document.getElementById("main-content")?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [pathname]);

  // The drawer exists below 900px only: growing past the breakpoint while it
  // is open would leave the page scroll-locked behind an invisible dialog.
  useEffect(() => {
    if (!menuOpen) return;
    const query = window.matchMedia("(min-width: 900px)");
    const onChange = () => {
      if (query.matches) setMenuOpen(false);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [menuOpen]);

  return (
    <div className={styles.shell}>
      {/* First focusable element of the page: skips the ~20 navigation
          entries, which would otherwise have to be tabbed through on every
          page change before reaching the content. */}
      <a href="#main-content" className="ui-skip-link">
        {t("nav.skipToContent")}
      </a>

      <div className={styles.sidebar}>
        <Sidebar
          currentUser={currentUser}
          onLogout={onLogout}
          theme={theme}
          onToggleTheme={handleToggleTheme}
        />
      </div>

      <div className={styles.content}>
        <header className={styles.topbar}>
          <IconButton
            icon={Menu}
            label={t("nav.openMenu")}
            aria-expanded={menuOpen}
            aria-controls={menuOpen ? "app-nav-drawer" : undefined}
            onClick={() => setMenuOpen(true)}
          />
          <span className={styles.brand}>
            <img src="/logo.png" alt="" className={styles.brandLogo} />
            <span className={styles.brandName}>{t("nav.brand")}</span>
          </span>
        </header>

        <main className={styles.main} id="main-content" tabIndex={-1}>
          {/* Every page gets currentUser so it can hide or disable the
              controls the role cannot use; the backend stays the
              authority. */}
          <PageBoundary>
            <Routes>
              {/* Main navigation */}
              <Route path="/" element={<DashboardPage currentUser={currentUser} />} />
              {/* 'My dashboard' inside the admin layout -- same component
                  as the standalone player view, mounted with embedded=true
                  so it inherits the admin navigation instead of taking over
                  the canvas.  Authenticated by the Discord cookie, not by
                  the panel role, so it takes no currentUser. */}
              <Route path="/me" element={<PlayerDashboardPage embedded />} />
              {/* Marketplace inside admin layout (embedded) */}
              <Route path="/market" element={<MarketPage embedded currentUser={currentUser} />} />
              <Route path="/serverforge" element={<ServerForgePage currentUser={currentUser} />} />
              <Route path="/online" element={<OnlinePlayersPage currentUser={currentUser} />} />
              <Route path="/players" element={<PlayersPage currentUser={currentUser} />} />
              {/* /containers is no longer a sidebar entry; the new
                  Instances page subsumes container discovery + import.
                  We keep a redirect for old bookmarks. */}
              <Route path="/containers" element={<Navigate to="/instances" replace />} />
              <Route path="/game-config" element={<GameConfigPage currentUser={currentUser} />} />
              <Route path="/servers-manager" element={<ServersPage currentUser={currentUser} />} />
              <Route path="/instances" element={<ServerInstancesPage currentUser={currentUser} />} />
              <Route path="/cluster-sync" element={<ClusterSyncPage currentUser={currentUser} />} />
              <Route path="/event-log" element={<EventLogPage currentUser={currentUser} />} />

              {/* Plugin management */}
              <Route path="/plugins/arkshop" element={<ArkShopPage currentUser={currentUser} />} />
              <Route path="/plugins/config" element={<ArkManiaConfigPage currentUser={currentUser} />} />
              <Route
                path="/plugins/config/:module"
                element={<ArkManiaConfigPage currentUser={currentUser} />}
              />
              <Route path="/plugins/bans" element={<BansPage currentUser={currentUser} />} />
              <Route path="/plugins/rare-dinos" element={<RareDinosPage currentUser={currentUser} />} />
              <Route
                path="/plugins/transfer-rules"
                element={<TransferRulesPage currentUser={currentUser} />}
              />
              <Route path="/plugins/decay" element={<DecayPage currentUser={currentUser} />} />
              <Route path="/plugins/player-map" element={<PlayerMapPage currentUser={currentUser} />} />
              <Route path="/plugins/leaderboard" element={<LeaderboardPage currentUser={currentUser} />} />

              {/* Settings */}
              <Route path="/settings/blueprints" element={<BlueprintsPage currentUser={currentUser} />} />
              <Route path="/settings/machines" element={<MachinesPage currentUser={currentUser} />} />
              <Route path="/settings/hardening" element={<HardeningPage currentUser={currentUser} />} />
              {/* Admin-only pages: rendered conditionally so the routes
                  simply do not exist for non-admin users.  Same set as the
                  sidebar's adminOnly entries. */}
              {currentUser?.role === "admin" && (
                <Route path="/settings/db" element={<DatabaseSettingsPage currentUser={currentUser} />} />
              )}
              {currentUser?.role === "admin" && (
                <Route path="/settings/general" element={<GeneralSettingsPage currentUser={currentUser} />} />
              )}
              {currentUser?.role === "admin" && (
                <Route path="/settings/users" element={<UsersPage currentUser={currentUser} />} />
              )}
              {currentUser?.role === "admin" && (
                <Route path="/settings/sql" element={<SqlConsolePage currentUser={currentUser} />} />
              )}
              {currentUser?.role === "admin" && (
                <Route path="/settings/discord" element={<DiscordSettingsPage currentUser={currentUser} />} />
              )}
              {currentUser?.role === "admin" && (
                <Route path="/settings/audit" element={<AuditLogPage currentUser={currentUser} />} />
              )}

              {/* Catch-all: redirect unknown paths to the dashboard */}
              <Route path="*" element={<DashboardPage currentUser={currentUser} />} />
            </Routes>
          </PageBoundary>
        </main>
      </div>

      {menuOpen && (
        <div ref={drawerRef} className={styles.drawer}>
          <div className={styles.scrim} onClick={closeMenu} />
          <div
            {...panelProps}
            id="app-nav-drawer"
            className={styles.drawerPanel}
            aria-label={t("nav.menu")}
          >
            <Sidebar
              currentUser={currentUser}
              onLogout={onLogout}
              onNavigate={closeMenu}
              onClose={closeMenu}
              closeButtonRef={drawerCloseRef}
              theme={theme}
              onToggleTheme={handleToggleTheme}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function App() {
  const { t } = useTranslation();
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);

  // Guard against concurrent status checks (e.g. React StrictMode double-invoke)
  const isCheckingRef = useRef(false);

  /** Query the backend to determine the initial auth state. */
  const checkStatus = useCallback(async () => {
    if (isCheckingRef.current) return;
    isCheckingRef.current = true;
    setAuthState("loading");

    try {
      const { data } = await settingsApi.status();
      if (!data.configured) {
        setAuthState("setup");
        return;
      }

      // Discord OAuth callback returns the panel JWT via the URL
      // fragment (#token=...).  Pick it up BEFORE the existing
      // sessionStorage check so a fresh Discord login wins over a
      // stale token left in the previous tab.  We scrub the fragment
      // immediately so a refresh / share-link doesn't leak it.
      const hash = window.location.hash || "";
      if (hash.startsWith("#token=")) {
        const fragmentToken = decodeURIComponent(hash.substring("#token=".length));
        if (fragmentToken) {
          setAuthToken(fragmentToken);
          window.history.replaceState({}, "",
            window.location.pathname + window.location.search);
        }
      }

      // If we have a JWT in sessionStorage from a previous page (e.g. the
      // user just hit F5), try to resolve it via /auth/me before falling
      // back to the login screen.  The axios interceptor already attaches
      // the Bearer header, so we just need to call authApi.me and let a
      // 401 bounce us into "login" state.
      if (getAuthToken()) {
        try {
          const { data: user } = await authApi.me();
          setCurrentUser(user);
          setAuthState("ready");
          return;
        } catch (err: unknown) {
          // Only a 401 means the token is invalid.  A 5xx or a network
          // error says nothing about it: rethrow to the error screen so
          // Retry keeps the session instead of wiping it.
          if ((err as { response?: { status?: number } })?.response?.status !== 401) {
            throw err;
          }
          // Invalid / expired token -- wipe and fall through to the
          // Discord probe below (maybe the operator only has a Discord
          // session left).
          setAuthToken(null);
          setCurrentUser(null);
        }
      }

      // No panel JWT: probe the Discord-session cookie.  If the Discord
      // OAuth callback set one (Phase 2), the user is a Discord-only
      // player and we route them to the PlayerDashboardPage.  A 401 here
      // just means no Discord session either -- fall through to login.
      try {
        const { data: discord } = await discordAuthApi.me();
        if (discord.discord_user_id) {
          setAuthState("player");
          return;
        }
      } catch {
        // No Discord session OR backend couldn't verify it -- treat as
        // 'not logged in' and land on the login page.  The /me/dashboard
        // endpoint will also 401/403 if the user ever reaches it by URL.
      }

      setAuthState("login");
    } catch (err: unknown) {
      // Keep only the backend detail.  Anything else (network error,
      // timeout) is left empty and translated at render time: axios'
      // own message is English, and calling t() here would make
      // checkStatus depend on the language and re-run the whole probe on
      // every language switch.
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      setErrorMessage(typeof detail === "string" ? detail : "");
      setAuthState("error");
    } finally {
      isCheckingRef.current = false;
    }
  }, []);

  useEffect(() => {
    // Register the global auth-error handler (clears token on a panel-JWT 401)
    setOnAuthError(() => {
      setCurrentUser(null);
      setAuthToken(null);
      setAuthState("login");
    });

    checkStatus();
  }, [checkStatus]);

  async function handleLogout(): Promise<void> {
    // A Discord sign-in also leaves the 24 h disc_session cookie, which
    // checkStatus turns into a player session on the next load: without
    // this, the next person on a shared browser was signed in as this
    // user's player.  Best-effort, the panel logout goes ahead regardless.
    await discordAuthApi.logout().catch(() => {});
    setAuthToken(null);
    setCurrentUser(null);
    setAuthState("login");
  }

  function handleLoggedIn(user: AuthUser): void {
    setCurrentUser(user);
    setAuthState("ready");
  }

  // ---------------------------------------------------------------------------
  // Auth overlay renderer
  // ---------------------------------------------------------------------------

  function renderAuthOverlay(): React.ReactNode {
    // The player state has its OWN full-page render (no admin navigation);
    // skip the overlay entirely so the dashboard takes over the canvas.
    if (authState === "ready" || authState === "player") return null;

    if (authState === "loading") {
      return (
        <div className="ui-auth">
          <div className={`ui-auth__card ${styles.authBrand}`}>
            <img src="/logo.png" alt="" className={styles.authLogo} />
            <Spinner label={t("common.loading")} />
          </div>
        </div>
      );
    }

    if (authState === "error") {
      return (
        <div className="ui-auth">
          <div className="ui-auth__card l-stack">
            <div className={styles.authBrand}>
              <img src="/logo.png" alt="" className={styles.authLogo} />
              <h1>{t("auth.connectionError")}</h1>
            </div>
            <Alert tone="danger">{errorMessage || t("auth.login.errorNetwork")}</Alert>
            <Button
              variant="primary"
              icon={RotateCw}
              onClick={checkStatus}
              className={styles.authAction}
            >
              {t("common.retry")}
            </Button>
          </div>
        </div>
      );
    }

    if (authState === "setup") {
      return <SetupWizard onComplete={() => setAuthState("login")} />;
    }

    if (authState === "login") {
      return <LoginPage onLoggedIn={handleLoggedIn} />;
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // The privacy policy must be readable BEFORE any login (GDPR Art. 13
  // notice), so it bypasses the auth state machine entirely.
  if (window.location.pathname === "/privacy") {
    return <PrivacyPage />;
  }

  return (
    <BrowserRouter>
      <ToastProvider>
        <ConfirmProvider>
          {renderAuthOverlay()}

          {/* Discord-only players see the dashboard with no admin navigation.
              The PlayerDashboardPage manages its own logout (clears the
              Discord session cookie and reloads the page).  Routes are
              scoped to the player surface area: dashboard + marketplace,
              everything else falls back to the dashboard. */}
          {authState === "player" && (
            <PageBoundary>
              <Routes>
                <Route path="/market" element={<MarketPage />} />
                <Route
                  path="*"
                  element={<PlayerDashboardPage onLogout={() => setAuthState("login")} />}
                />
              </Routes>
            </PageBoundary>
          )}

          {authState === "ready" && (
            <AppShell currentUser={currentUser} onLogout={handleLogout} />
          )}
        </ConfirmProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}

export default App;
