import { describe, expect, test } from "vitest";
import {
  DEFAULT_ACTIVE_POLL_INTERVAL_MS,
  DEFAULT_POLL_INTERVAL_MS,
  MIN_ACTIVE_POLL_INTERVAL_MS,
  MIN_POLL_INTERVAL_MS,
  migrateHostPing,
  useHostPingStore,
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

  test("keeps a deliberate idle interval set above the old default", () => {
    const out = migrateHostPing({ pollIntervalMs: 15_000, activePollIntervalMs: 2_000 }, 0);
    expect(out.pollIntervalMs).toBe(15_000);
  });

  test("keeps a deliberate active interval set above the old default", () => {
    const out = migrateHostPing({ pollIntervalMs: 10_000, activePollIntervalMs: 3_000 }, 0);
    expect(out.activePollIntervalMs).toBe(3_000);
  });

  test("raises an at-old-default idle interval", () => {
    const out = migrateHostPing({ pollIntervalMs: 10_000, activePollIntervalMs: 30_000 }, 0);
    expect(out.pollIntervalMs).toBe(DEFAULT_POLL_INTERVAL_MS);
  });

  test("raises an at-old-default active interval", () => {
    const out = migrateHostPing({ pollIntervalMs: 300_000, activePollIntervalMs: 2_000 }, 0);
    expect(out.activePollIntervalMs).toBe(DEFAULT_ACTIVE_POLL_INTERVAL_MS);
  });
});

describe("store setter clamping", () => {
  test("setPollIntervalMs floors a sub-minimum value", () => {
    useHostPingStore.getState().setPollIntervalMs(500);
    expect(useHostPingStore.getState().pollIntervalMs).toBe(MIN_POLL_INTERVAL_MS);
  });

  test("setPollIntervalMs floors zero", () => {
    useHostPingStore.getState().setPollIntervalMs(0);
    expect(useHostPingStore.getState().pollIntervalMs).toBe(MIN_POLL_INTERVAL_MS);
  });

  test("setActivePollIntervalMs floors a sub-minimum value", () => {
    useHostPingStore.getState().setActivePollIntervalMs(500);
    expect(useHostPingStore.getState().activePollIntervalMs).toBe(MIN_ACTIVE_POLL_INTERVAL_MS);
  });

  test("setActivePollIntervalMs floors zero", () => {
    useHostPingStore.getState().setActivePollIntervalMs(0);
    expect(useHostPingStore.getState().activePollIntervalMs).toBe(MIN_ACTIVE_POLL_INTERVAL_MS);
  });
});
