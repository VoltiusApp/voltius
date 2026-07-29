import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const id = process.env.VOLTIUS_PLUGIN_ID;
if (!id) throw new Error("VOLTIUS_PLUGIN_ID is required");

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  build: {
    outDir: path.resolve(__dirname, `src-tauri/resources/plugins/${id}`),
    emptyOutDir: true,
    lib: {
      entry: path.resolve(__dirname, `src/plugins/${id}/index.ts`),
      formats: ["es"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      external: ["react", "react/jsx-runtime", "@voltius/ui", "@voltius/api"],
    },
  },
});
