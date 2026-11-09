// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { LOCK_ACTION_KEY, LOCK_TIMEOUT_KEY } from "@/services/lockPolicy";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/invoke", () => ({ invoke: mocks.invoke }));
vi.mock("@/services/clientHeaders", () => ({ clientVersion: async () => "0.67.0" }));

const LEGACY = "voltius-org-lock-policy";
const legacy = (policy: unknown) => localStorage.setItem(LEGACY, JSON.stringify({ state: { policy }, version: 0 }));

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

it("seeds an empty team layer from the legacy lock policy, then revalidates on the first refresh", async () => {
  legacy({ maxMinutes: 15, forceVault: true });
  const { useTeamPolicyStore } = await import("./teamPolicyStore");
  expect(useTeamPolicyStore.getState().layer).toEqual({
    policy: { [LOCK_TIMEOUT_KEY]: { $range: { max: 15 } }, [LOCK_ACTION_KEY]: "vault" },
    teams: { [LOCK_TIMEOUT_KEY]: [], [LOCK_ACTION_KEY]: [] },
    issues: [],
  });
  expect(localStorage.getItem(LEGACY)).toBeNull();

  const { refreshTeamPolicy } = await import("@/services/policy/teamPolicy");
  await refreshTeamPolicy([]);
  expect(useTeamPolicyStore.getState().layer).toBeNull();
});

it("keeps an existing team layer and still drops the legacy key", async () => {
  const layer = { policy: { [LOCK_ACTION_KEY]: "screen" }, teams: { [LOCK_ACTION_KEY]: ["Acme"] }, issues: [] };
  localStorage.setItem("voltius-team-policy", JSON.stringify({ state: { layer, inputs: "x" }, version: 1 }));
  legacy({ maxMinutes: 15, forceVault: true });
  const { useTeamPolicyStore } = await import("./teamPolicyStore");
  expect(useTeamPolicyStore.getState()).toMatchObject({ layer, inputs: "x" });
  expect(localStorage.getItem(LEGACY)).toBeNull();
});

it("drops an unreadable legacy key without seeding", async () => {
  localStorage.setItem(LEGACY, "{");
  const { useTeamPolicyStore } = await import("./teamPolicyStore");
  expect(useTeamPolicyStore.getState().layer).toBeNull();
  expect(localStorage.getItem(LEGACY)).toBeNull();
});
