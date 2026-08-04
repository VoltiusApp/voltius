import { describe, expect, test } from "vitest";
import {
  DEFAULT_ACTIVE_POLL_INTERVAL_MS,
  DEFAULT_POLL_INTERVAL_MS,
  MIN_POLL_INTERVAL_MS,
  migrateHostPing,
} from "./hostPingStore";

describe("hostPingStore defaults", () => {
  test("idle default is a minute", () => {
    expect(DEFAULT_POLL_INTERVAL_MS).toBe(60_000);
  });

  test("session default is five seconds", () => {
    expect(DEFAULT_ACTIVE_POLL_INTERVAL_MS).toBe(5_000);
  });
});

describe("migrateHostPing", () => {
  test("raises a stale sub-minimum idle interval to the new default", () => {
    const out = migrateHostPing({ pollIntervalMs: 10_000, activePollIntervalMs: 2_000 }, 0);
    expect(out.pollIntervalMs).toBe(DEFAULT_POLL_INTERVAL_MS);
  });

  test("raises a stale fast interval to the new default", () => {
    const out = migrateHostPing({ pollIntervalMs: 10_000, activePollIntervalMs: 2_000 }, 0);
    expect(out.activePollIntervalMs).toBe(DEFAULT_ACTIVE_POLL_INTERVAL_MS);
  });

  test("keeps a deliberately slower idle interval", () => {
    const out = migrateHostPing({ pollIntervalMs: 300_000, activePollIntervalMs: 30_000 }, 0);
    expect(out.pollIntervalMs).toBe(300_000);
    expect(out.activePollIntervalMs).toBe(30_000);
  });

  test("leaves already-migrated state alone", () => {
    const out = migrateHostPing({ pollIntervalMs: 15_000, activePollIntervalMs: 2_000 }, 1);
    expect(out.pollIntervalMs).toBe(15_000);
    expect(out.activePollIntervalMs).toBe(2_000);
  });

  test("the idle minimum is above ufw limit's 6-per-30s threshold", () => {
    expect(MIN_POLL_INTERVAL_MS).toBeGreaterThanOrEqual(10_000);
  });
});
