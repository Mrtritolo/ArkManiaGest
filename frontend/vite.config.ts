import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The UI used to hardcode its version string, so the sidebar kept showing
// 3.5.5 release after release.  Inject package.json instead: one source of
// truth, nothing to remember at bump time.
const pkgVersion = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
).version as string

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkgVersion),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      // Served outside /api/v1 (systemApi.health); Nginx proxies it in prod.
      '/health': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    // No `rollupOptions.input`: the single entry stays the default
    // index.html.  That is what keeps the dev-only UI-kit harness
    // (uikit.html + src/uikit/) out of the shipped bundle -- it is
    // unreachable from index.html, so nothing of it is emitted into dist/.
    // Adding a second input here would ship it.
    outDir: 'dist',
    sourcemap: false,
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          icons: ['lucide-react'],
        },
      },
    },
  },
  esbuild: {
    // console.warn is kept in production builds for debugging (to be removed
    // later); only debugger statements are dropped.
    drop: mode === 'production' ? ['debugger'] : [],
  },
}))
