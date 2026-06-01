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
