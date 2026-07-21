import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    // Per-file isolation (vitest default `isolate: true`) is load-bearing: several team
    // tests mock module singletons (teamVaultSync `_teamKeyCache`, zustand stores/persist,
    // `navigator.onLine`) and rely on a fresh module registry + globals per file. Do not
    // disable isolation without giving those tests explicit cross-file resets.
    environment: "jsdom",
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "tests/**/*.{test,spec}.ts",
    ],
  },
});
