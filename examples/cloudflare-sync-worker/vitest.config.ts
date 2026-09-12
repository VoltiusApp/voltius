import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        // R2 isolated storage pop is flaky in vitest-pool-workers (shm files).
        // Tests clear the bucket in beforeEach instead.
        isolatedStorage: false,
      },
    },
  },
});
