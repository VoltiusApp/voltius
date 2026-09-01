import { defineConfig } from "vitest/config";
import path from "path";
import { lucideSubset } from "./vite-plugin-lucide-subset";

export default defineConfig({
  // Resolve virtual:lucide-subset module imported by ui.ts transitively via src/utils/icons.ts
  plugins: [lucideSubset()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // First-party plugin source imports this as a bare specifier (resolved to a
      // host module at runtime via hostModules.ts); map it to the real module here
      // so first-party plugin unit tests can import it directly, same shared React.
      "@voltius/ui": path.resolve(__dirname, "./src/plugins/ui.ts"),
      "@voltius/tools": path.resolve(__dirname, "./src/plugins/toolSurface/index.ts"),
    },
  },
  test: {
    // Per-file isolation (vitest default `isolate: true`) is load-bearing: several team
    // tests mock module singletons (teamVaultSync `_teamKeyCache`, zustand stores/persist,
    // `navigator.onLine`) and rely on a fresh module registry + globals per file. Do not
    // disable isolation without giving those tests explicit cross-file resets.
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "tests/**/*.{test,spec}.ts",
    ],
  },
});
