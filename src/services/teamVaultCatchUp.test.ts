// @vitest-environment jsdom
import { test, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({ fetchTeamData: vi.fn(async (_id: string, _opts?: { background?: boolean }) => {}) }));
vi.mock("@/services/teamVaultSync", () => ({ fetchTeamData: h.fetchTeamData }));

import { cancelTeamVaultCatchUp, catchUpTeamVaults } from "./teamVaultCatchUp";
import { useTeamStore, type Team } from "@/stores/teamStore";
import { useTeamVaultStateStore } from "@/stores/teamVaultStateStore";

let clock = Date.UTC(2030, 0, 1);
const fetched = () => h.fetchTeamData.mock.calls.map(([id]) => id);

beforeEach(() => {
  vi.useFakeTimers({ now: (clock += 3_600_000) });
  h.fetchTeamData.mockReset().mockResolvedValue(undefined);
  useTeamStore.setState({ teams: [{ id: "a" }, { id: "b" }, { id: "c" }] as Team[] });
  useTeamVaultStateStore.setState({ statusByTeamId: { a: "loaded", b: "awaiting_key", c: "loaded" } });
});

afterEach(async () => {
  cancelTeamVaultCatchUp();
  vi.useRealTimers();
});

test("refetches only loaded vaults, in the background, one after another", async () => {
  let release = () => {};
  h.fetchTeamData.mockImplementationOnce(() => new Promise<void>((r) => { release = r; }));

  catchUpTeamVaults();
  await vi.advanceTimersByTimeAsync(0);
  expect(fetched()).toEqual(["a"]);

  release();
  await vi.advanceTimersByTimeAsync(0);
  expect(fetched()).toEqual(["a", "c"]);
  expect(h.fetchTeamData.mock.calls.every(([, opts]) => opts?.background)).toBe(true);
});

test("runs at most once a minute, with one trailing run for the calls in between", async () => {
  catchUpTeamVaults();
  await vi.advanceTimersByTimeAsync(0);
  expect(fetched()).toHaveLength(2);

  for (let i = 0; i < 5; i++) {
    await vi.advanceTimersByTimeAsync(5_000);
    catchUpTeamVaults();
  }
  expect(fetched()).toHaveLength(2);

  await vi.advanceTimersByTimeAsync(35_000);
  expect(fetched()).toHaveLength(4);

  await vi.advanceTimersByTimeAsync(120_000);
  expect(fetched()).toHaveLength(4);
});

test("a cancelled trailing run never fires", async () => {
  catchUpTeamVaults();
  await vi.advanceTimersByTimeAsync(10_000);
  catchUpTeamVaults();

  cancelTeamVaultCatchUp();
  await vi.advanceTimersByTimeAsync(120_000);

  expect(fetched()).toHaveLength(2);
});
