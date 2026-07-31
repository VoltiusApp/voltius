import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import path from "path";
import { lucideSubset } from "./vite-plugin-lucide-subset";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react(), svgr(), lucideSubset()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Not part of the host's production import graph (plugin bundles resolve this
      // specifier at runtime via hostModules.ts, and vite.plugins.config.ts's
      // `external` keeps it out of built bundles) — but the dev server transforms any
      // file under root on direct request, independent of the module graph, and a
      // first-party plugin's TS source (e.g. src/plugins/gist-sync/SettingsPage.tsx)
      // is reachable that way. Without this, such a request 500s with an unresolved
      // "@voltius/ui" specifier and the client shows a full-screen error overlay.
      // Same target as tsconfig.json's `paths` and vitest.config.ts's alias.
      "@voltius/ui": path.resolve(__dirname, "./src/plugins/ui.ts"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (["@xterm/xterm", "@xterm/addon-fit", "@xterm/addon-webgl", "@xterm/addon-search", "@xterm/addon-web-links"].some((pkg) => id.includes(`/node_modules/${pkg}/`))) return "xterm";
          if (["react", "react-dom"].some((pkg) => id.includes(`/node_modules/${pkg}/`))) return "react";
        },
      },
    },
  },
  clearScreen: false,
  server: {
    port: parseInt(process.env.VITE_PORT ?? "1420"),
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
