import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  listIdentityPicks: vi.fn(),
  setObjectPick: vi.fn(async () => {}),
  setTeamDefaultPick: vi.fn(async () => {}),
}));
vi.mock("@/services/teamObjects", () => h);

import { useIdentityPickStore } from "./identityPickStore";

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useIdentityPickStore.setState({ byObject: {}, byTeam: {}, status: "unknown" });
});

test("load replaces picks from the server", async () => {
  h.listIdentityPicks.mockResolvedValue({
    objects: [{ object_id: "h1", identity_id: "own", updated_at: "" }],
    defaults: [{ team_id: "t1", identity_id: "own", updated_at: "" }],
  });
  await useIdentityPickStore.getState().load();
  expect(useIdentityPickStore.getState()).toMatchObject({ byObject: { h1: "own" }, byTeam: { t1: "own" }, status: "loaded" });
});

test.each(["unknown", "loaded"] as const)("load failure keeps cached picks and the %s status", async (status) => {
  useIdentityPickStore.setState({ byObject: { h1: "own" }, status });
  h.listIdentityPicks.mockRejectedValue(new Error("offline"));
  await expect(useIdentityPickStore.getState().load()).rejects.toThrow("offline");
  expect(useIdentityPickStore.getState()).toMatchObject({ byObject: { h1: "own" }, status });
});

test("a server without the routes is unsupported and holds no picks", async () => {
  useIdentityPickStore.setState({ byObject: { h1: "own" } });
  h.listIdentityPicks.mockResolvedValue(null);
  await useIdentityPickStore.getState().load();
  expect(useIdentityPickStore.getState()).toMatchObject({ byObject: {}, byTeam: {}, status: "unsupported" });
});

test("concurrent loads share one request", async () => {
  h.listIdentityPicks.mockResolvedValue({ objects: [], defaults: [] });
  await Promise.all([useIdentityPickStore.getState().load(), useIdentityPickStore.getState().load()]);
  expect(h.listIdentityPicks).toHaveBeenCalledTimes(1);
});

test("a failed write rolls back", async () => {
  useIdentityPickStore.setState({ byObject: { h1: "old" } });
  h.setObjectPick.mockRejectedValueOnce(new Error("500"));
  await expect(useIdentityPickStore.getState().setHostPick("h1", "new")).rejects.toThrow("500");
  expect(useIdentityPickStore.getState().byObject).toEqual({ h1: "old" });
});

test("clearing a pick removes the entry and calls the server with null", async () => {
  useIdentityPickStore.setState({ byTeam: { t1: "own" } });
  await useIdentityPickStore.getState().setVaultDefault("t1", null);
  expect(useIdentityPickStore.getState().byTeam).toEqual({});
  expect(h.setTeamDefaultPick).toHaveBeenCalledWith("t1", null);
});

test("picks persist under the account-scoped key, status does not", async () => {
  await useIdentityPickStore.getState().setHostPick("h1", "own");
  const saved = JSON.parse(localStorage.getItem("voltius-identity-picks") ?? "{}");
  expect(saved.state).toEqual({ byObject: { h1: "own" }, byTeam: {} });
});
