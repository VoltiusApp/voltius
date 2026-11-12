// @vitest-environment jsdom
import { test, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({ fetchTeamData: vi.fn(async (_id: string, _opts?: { background?: boolean }) => {}) }));
vi.mock("@/services/teamVaultSync", () => ({ fetchTeamData: h.fetchTeamData }));

import { cancelTeamVaultCatchUp, catchUpTeamVaults, forgetTeamDataSeen, listedDataVersion, noteTeamDataSeen } from "./teamVaultCatchUp";
import { useTeamStore, type Team } from "@/stores/teamStore";
import { useTeamVaultStateStore } from "@/stores/teamVaultStateStore";

let clock = Date.UTC(2030, 0, 1);
let listed: Team[] = [];
const loadTeams = vi.fn(async () => { useTeamStore.setState({ teams: listed }); });
const fetched = () => h.fetchTeamData.mock.calls.map(([id]) => id);
const team = (id: string, data_version?: number) => ({ id, data_version }) as Team;

async function catchUp(refetchUnversioned: boolean) {
  catchUpTeamVaults({ refetchUnversioned });
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers({ now: (clock += 3_600_000) });
  forgetTeamDataSeen();
  h.fetchTeamData.mockReset().mockImplementation(async (id) => noteTeamDataSeen(id, listedDataVersion(id)));
  loadTeams.mockClear();
  listed = [team("a", 3), team("b", 3), team("c", 3)];
  useTeamStore.setState({ teams: listed, loadTeams });
  useTeamVaultStateStore.setState({ statusByTeamId: { a: "loaded", b: "awaiting_key", c: "loaded" } });
  noteTeamDataSeen("a", 3);
  noteTeamDataSeen("c", 3);
});

afterEach(() => {
  cancelTeamVaultCatchUp();
  vi.useRealTimers();
});

test("reloads the team list and refetches only loaded vaults whose version moved, in the background", async () => {
  listed = [team("a", 3), team("b", 4), team("c", 5)];

  await catchUp(true);

  expect(loadTeams).toHaveBeenCalledTimes(1);
  expect(fetched()).toEqual(["c"]);
  expect(h.fetchTeamData.mock.calls.every(([, opts]) => opts?.background)).toBe(true);
});

test("a vault refetched once is not refetched again until its version moves", async () => {
  listed = [team("a", 4), team("b", 3), team("c", 3)];
  await catchUp(false);
  await vi.advanceTimersByTimeAsync(60_000);
  await catchUp(false);

  expect(fetched()).toEqual(["a"]);
});

test("refetches one vault at a time", async () => {
  listed = [team("a", 4), team("b", 3), team("c", 4)];
  let release = () => {};
  h.fetchTeamData.mockImplementationOnce(() => new Promise<void>((r) => { release = r; }));

  await catchUp(false);
  expect(fetched()).toEqual(["a"]);

  release();
  await vi.advanceTimersByTimeAsync(0);
  expect(fetched()).toEqual(["a", "c"]);
});

test("a server that lists no version gets every loaded vault refetched, but only when asked", async () => {
  listed = [team("a"), team("b"), team("c")];

  await catchUp(false);
  expect(fetched()).toEqual([]);

  await vi.advanceTimersByTimeAsync(60_000);
  await catchUp(true);
  expect(fetched()).toEqual(["a", "c"]);
});

test("runs at most once a minute, with one trailing run that keeps the strongest request", async () => {
  listed = [team("a"), team("b"), team("c")];
  await catchUp(false);

  for (let i = 0; i < 5; i++) {
    await vi.advanceTimersByTimeAsync(5_000);
    catchUpTeamVaults({ refetchUnversioned: i === 2 });
  }
  expect(loadTeams).toHaveBeenCalledTimes(1);

  await vi.advanceTimersByTimeAsync(35_000);
  expect(loadTeams).toHaveBeenCalledTimes(2);
  expect(fetched()).toEqual(["a", "c"]);

  await vi.advanceTimersByTimeAsync(120_000);
  expect(loadTeams).toHaveBeenCalledTimes(2);
});

test("a cancelled trailing run never fires", async () => {
  await catchUp(false);
  await vi.advanceTimersByTimeAsync(10_000);
  catchUpTeamVaults({ refetchUnversioned: true });

  cancelTeamVaultCatchUp();
  await vi.advanceTimersByTimeAsync(120_000);

  expect(loadTeams).toHaveBeenCalledTimes(1);
});
