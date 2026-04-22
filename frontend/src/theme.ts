/**
 * theme.ts -- Light/dark theme switcher.
 *
 * The active theme is stored as a `data-theme` attribute on `<html>`.  All
 * the colour decisions live in CSS variables; see `:root` (dark) and
 * `[data-theme="light"]` in `src/index.css` for the actual palettes.
 *
 * Persistence is in `localStorage` so the choice survives full reloads;
 * the initial value is read in :func:`initTheme` (called from main.tsx
 * before the React tree mounts) so there's no flash of the wrong theme.
 *
 * If the user never made a choice we fall back to whatever `prefers-color-scheme`
 * reports, defaulting to `dark` on browsers that don't support it.
 */

export type Theme = "dark" | "light";

export const SUPPORTED_THEMES: Theme[] = ["dark", "light"];

const STORAGE_KEY = "arkmaniagest.theme";

function readStoredTheme(): Theme | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "dark" || v === "light" ? v : null;
  } catch {
    return null;
  }
}

function detectSystemTheme(): Theme {
  try {
    if (window.matchMedia?.("(prefers-color-scheme: light)").matches) {
      return "light";
    }
  } catch { /* matchMedia not available */ }
  return "dark";
}

/** Apply the active theme to the <html> element. */
function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

/**
 * Resolve and apply the initial theme.
 *
 * Call exactly once, before React mounts, so the first paint already has
 * the correct palette and no flash of the opposite theme appears.
 */
export function initTheme(): Theme {
  const theme = readStoredTheme() ?? detectSystemTheme();
  applyTheme(theme);
  return theme;
}

/** Read whichever theme is currently active on the document. */
export function getCurrentTheme(): Theme {
  const t = document.documentElement.getAttribute("data-theme");
  return t === "light" ? "light" : "dark";
}

/**
 * Persist + apply a new theme.
 *
 * No DOM event is broadcast -- React components that show the active
 * theme should call :func:`getCurrentTheme` from their own click handler
 * (or hold the value in local state) and re-render after this returns.
 */
export function setTheme(theme: Theme): void {
  applyTheme(theme);
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* storage may be disabled (private mode) -- DOM attribute still works
       for the current page session. */
  }
}

/** Convenience: flip between dark and light. */
export function toggleTheme(): Theme {
  const next: Theme = getCurrentTheme() === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}
