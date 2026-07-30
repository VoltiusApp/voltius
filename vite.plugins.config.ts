import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { HOST_SPECIFIERS } from "./src/plugins/hostSpecifiers";

const id = process.env.VOLTIUS_PLUGIN_ID;
if (!id) throw new Error("VOLTIUS_PLUGIN_ID is required");

// Vite derives `isProduction` (and @vitejs/plugin-react's dev-vs-prod JSX transform
// choice) directly from `process.env.NODE_ENV` at config-resolution time — not from
// the `build` command or any `mode` field. Whatever invokes this config (a plain
// shell, a script, or — as happened — a test runner whose own NODE_ENV=test leaks
// into a spawned `vite build` subprocess) must not be able to ship a dev-mode bundle
// that imports `jsxDEV` from a runtime the host doesn't expose. Force it here, once,
// so the artifact is correct regardless of the caller's ambient environment.
process.env.NODE_ENV = "production";

export default defineConfig({
  plugins: [react()],
  publicDir: false,
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  // Plugin bundles run in the webview, not Node — there is no `process` global there.
  // Dependencies (e.g. @tanstack/react-virtual) reference process.env.NODE_ENV for
  // dev-only branches; without this define the reference survives into the artifact
  // as a bare `process.env.NODE_ENV` and throws ReferenceError: process is not defined
  // at module-evaluation time in the real webview (unit tests run under jsdom/Node,
  // where `process` exists, so this does not surface in the suite).
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: path.resolve(__dirname, `src-tauri/resources/plugins/${id}`),
    emptyOutDir: true,
    lib: {
      entry: path.resolve(__dirname, `src/plugins/${id}/index.ts`),
      formats: ["es"],
      fileName: () => "index.js",
      // Pin the CSS output filename explicitly rather than relying on Vite's default
      // (derived from root package.json's "name" field) — the seeded-plugin loader
      // (src/plugins/seeded.ts) reads this exact filename to inject a plugin's styles.
      cssFileName: "voltius",
    },
    rollupOptions: {
      external: [...HOST_SPECIFIERS],
    },
  },
});
