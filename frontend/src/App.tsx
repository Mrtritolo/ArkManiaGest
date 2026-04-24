/**
 * App.tsx — Root component and application shell.
 *
 * Auth state machine:
 *   loading → (backend unreachable) → error
 *           → (no users in DB)      → setup
 *           → (users exist)         → login
 *                                   → ready  (after successful login)
 *
 * The overlay (setup / login / loading / error) is rendered on top of the
 * main layout.  Once the state reaches "ready", the overlay is removed and
 * the full sidebar + route tree becomes interactive.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import {
  settingsApi,
  authApi,
  setAuthToken,
  getAuthToken,
  setOnAuthError,
} from "./services/api";
import type { AuthUser } from "./types";

// Layout
import Sidebar from "./components/Sidebar";

// Auth / setup overlays
import SetupWizard from "./pages/SetupWizard";
import LoginPage from "./pages/LoginPage";

// App pages
import DashboardPage from "./pages/DashboardPage";
import DatabaseSettingsPage from "./pages/DatabaseSettingsPage";
import MachinesPage from "./pages/MachinesPage";
import GeneralSettingsPage from "./pages/GeneralSettingsPage";
import ServerForgePage from "./pages/ServerForgePage";
import PlayersPage from "./pages/PlayersPage";
import ArkShopPage from "./pages/ArkShopPage";
import BlueprintsPage from "./pages/BlueprintsPage";
import GameConfigPage from "./pages/GameConfigPage";
import OnlinePlayersPage from "./pages/OnlinePlayersPage";
import ArkManiaConfigPage from "./pages/ArkManiaConfigPage";
import BansPage from "./pages/BansPage";
import RareDinosPage from "./pages/RareDinosPage";
import TransferRulesPage from "./pages/TransferRulesPage";
import DecayPage from "./pages/DecayPage";
import LeaderboardPage from "./pages/LeaderboardPage";
import UsersPage from "./pages/UsersPage";
import DiscordSettingsPage from "./pages/DiscordSettingsPage";
import SqlConsolePage from "./pages/SqlConsolePage";
import ServersPage from "./pages/ServersPage";
import ServerInstancesPage from "./pages/ServerInstancesPage";
import EventLogPage from "./pages/EventLogPage";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AuthState = "loading" | "setup" | "login" | "ready" | "error";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function App() {
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
        } catch {
          // Invalid / expired token -- wipe and fall through to login.
          setAuthToken(null);
          setCurrentUser(null);
        }
      }

      setAuthState("login");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Cannot reach the backend.";
      setErrorMessage(message);
      setAuthState("error");
    } finally {
      isCheckingRef.current = false;
    }
  }, []);

  useEffect(() => {
    // Register the global auth-error handler (clears token on 401 / 503)
    setOnAuthError(() => {
      setCurrentUser(null);
      setAuthToken(null);
      setAuthState("login");
    });

    checkStatus();
  }, [checkStatus]);

  function handleLogout(): void {
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
    if (authState === "ready") return null;

    if (authState === "loading") {
      return (
        <div className="auth-overlay">
          <div className="unlock-container" style={{ textAlign: "center" }}>
            <img src="/logo.png" alt="ArkMania" className="setup-logo" />
            <p className="setup-subtitle" style={{ marginTop: "1rem" }}>
              Loading…
            </p>
          </div>
        </div>
      );
    }

    if (authState === "error") {
      return (
        <div className="auth-overlay">
          <div className="unlock-container">
            <div className="setup-header">
              <img
                src="/logo.png"
                alt="ArkMania"
                className="setup-logo"
                style={{ opacity: 0.5 }}
              />
              <h1 className="setup-title">Connection Error</h1>
            </div>
            <div className="alert alert-error">{errorMessage}</div>
            <div className="setup-actions" style={{ marginTop: "1rem" }}>
              <button onClick={checkStatus} className="btn btn-primary">
                Retry
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (authState === "setup") {
      return (
        <div className="auth-overlay">
          <SetupWizard onComplete={() => setAuthState("login")} />
        </div>
      );
    }

    if (authState === "login") {
      return (
        <div className="auth-overlay">
          <LoginPage onLoggedIn={handleLoggedIn} />
        </div>
      );
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <BrowserRouter>
      {renderAuthOverlay()}

      {authState === "ready" && (
        <div className="app-layout">
          <Sidebar currentUser={currentUser} onLogout={handleLogout} />

          <main className="app-main">
            <Routes>
              {/* Main navigation */}
              <Route path="/" element={<DashboardPage />} />
              <Route path="/serverforge" element={<ServerForgePage />} />
              <Route path="/online" element={<OnlinePlayersPage />} />
              <Route path="/players" element={<PlayersPage />} />
              {/* /containers is no longer a sidebar entry; the new
                  Instances page subsumes container discovery + import.
                  We keep a redirect for old bookmarks. */}
              <Route path="/containers" element={<Navigate to="/instances" replace />} />
              <Route path="/game-config" element={<GameConfigPage />} />
              <Route path="/servers-manager" element={<ServersPage />} />
              <Route
                path="/instances"
                element={<ServerInstancesPage currentUser={currentUser} />}
              />
              <Route path="/event-log" element={<EventLogPage />} />

              {/* Plugin management */}
              <Route path="/plugins/arkshop" element={<ArkShopPage />} />
              <Route path="/plugins/config" element={<ArkManiaConfigPage />} />
              <Route
                path="/plugins/config/:module"
                element={<ArkManiaConfigPage />}
              />
              <Route path="/plugins/bans" element={<BansPage />} />
              <Route path="/plugins/rare-dinos" element={<RareDinosPage />} />
              <Route
                path="/plugins/transfer-rules"
                element={<TransferRulesPage />}
              />
              <Route path="/plugins/decay" element={<DecayPage />} />
              <Route
                path="/plugins/leaderboard"
                element={<LeaderboardPage />}
              />

              {/* Settings */}
              <Route
                path="/settings/blueprints"
                element={<BlueprintsPage />}
              />
              <Route
                path="/settings/db"
                element={<DatabaseSettingsPage />}
              />
              <Route path="/settings/machines" element={<MachinesPage />} />
              <Route
                path="/settings/general"
                element={<GeneralSettingsPage />}
              />
              {/* Admin-only pages: rendered conditionally so the routes
                  simply do not exist for non-admin users. */}
              {currentUser?.role === "admin" && (
                <Route path="/settings/users" element={<UsersPage />} />
              )}
              {currentUser?.role === "admin" && (
                <Route path="/settings/sql" element={<SqlConsolePage />} />
              )}
              {currentUser?.role === "admin" && (
                <Route path="/settings/discord" element={<DiscordSettingsPage />} />
              )}

              {/* Catch-all: redirect unknown paths to the dashboard */}
              <Route path="*" element={<DashboardPage />} />
            </Routes>
          </main>
        </div>
      )}
    </BrowserRouter>
  );
}

export default App;
