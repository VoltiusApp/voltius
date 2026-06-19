import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "jsdom",
    // Legacy *.test.ts are node --experimental-strip-types scripts; vitest only collects *.spec.ts(x).
    include: ["src/**/*.spec.ts", "src/**/*.spec.tsx"],
  },
});
