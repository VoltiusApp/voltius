import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    fileParallelism: false,
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        // R2 isolated storage pop is flaky in vitest-pool-workers (shm files).
        // Tests clear the bucket in beforeEach and run files serially instead.
        isolatedStorage: false,
        singleWorker: true,
      },
    },
  },
});
