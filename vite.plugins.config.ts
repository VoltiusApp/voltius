import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const id = process.env.VOLTIUS_PLUGIN_ID;
if (!id) throw new Error("VOLTIUS_PLUGIN_ID is required");

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
    },
    rollupOptions: {
      external: ["react", "react/jsx-runtime", "react-dom", "@voltius/ui", "@voltius/api"],
    },
  },
});
