// @vitest-environment jsdom
import { test, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  refresh: vi.fn(),
  load: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@/services/vault", () => ({
  getSecret: vi.fn(),
  storeSecret: vi.fn(),
  purgeLocalSecrets: vi.fn(async (keys: string[]) => keys),
}));
vi.mock("@/services/teamService", async (orig) => ({
  ...(await orig<object>()),
  listTeams: vi.fn(async () => []),
}));
vi.mock("@/services/teamDataManager", () => ({
  refreshAwaitingKeyTeams: vi.fn(async () => {}),
  joinAndLoadTeamVault: vi.fn(async () => {}),
  onTeamLogin: vi.fn(async () => {}),
}));
vi.mock("@/services/authTokens", async (orig) => ({
  ...(await orig<object>()),
  refreshAccessToken: h.refresh,
}));

import { handleRealtimeEvent } from "./sync";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { useTeamStore } from "@/stores/teamStore";
import { useNotificationStore } from "@/stores/notificationStore";

beforeEach(() => {
  vi.useFakeTimers();
  h.refresh.mockReset();
  h.refresh.mockResolvedValue({ jwt: "x.y.z" });
  h.load.mockReset();
  h.load.mockResolvedValue(undefined);
  useSubscriptionStore.setState({
    load: h.load,
    isPro: true,
    isTeams: true,
    tier: "teams",
    seatTeam: { id: "t1", trial: false },
  } as never);
  useTeamStore.setState({ teams: [{ id: "t1", name: "Acme", role_ids: [] } as never] });
  useNotificationStore.setState({ toasts: [] });
});

afterEach(() => vi.useRealTimers());

const toastMessages = () => useNotificationStore.getState().toasts.map((t) => t.message);

test("plan_changed_refreshes_token_and_reloads_tier", async () => {
  await handleRealtimeEvent("plan_changed", "dev");
  expect(h.refresh).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(4_100);
  expect(h.refresh).toHaveBeenCalledTimes(1);
  expect(h.load).toHaveBeenCalled();
});

test("the refresh is jittered past the debounce so a team does not refresh at once", async () => {
  const random = vi.spyOn(Math, "random").mockReturnValue(0.9);
  try {
    await handleRealtimeEvent("plan_changed", "dev");
    await vi.advanceTimersByTimeAsync(3_600);
    expect(h.refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(h.refresh).toHaveBeenCalledTimes(1);
  } finally {
    random.mockRestore();
  }
});

test("a burst of plan and membership events refreshes once", async () => {
  await handleRealtimeEvent("plan_changed", "dev");
  await handleRealtimeEvent("plan_changed", "dev");
  await handleRealtimeEvent("membership_changed:added:t2", "dev");
  await vi.advanceTimersByTimeAsync(4_100);
  expect(h.refresh).toHaveBeenCalledTimes(1);
});

test("membership_removed_refreshes_token", async () => {
  await handleRealtimeEvent("membership_changed:removed:t1", "dev");
  await vi.advanceTimersByTimeAsync(4_100);
  expect(h.refresh).toHaveBeenCalledTimes(1);
});

test("seat_loss_toast_names_the_team", async () => {
  h.load.mockImplementation(async () => {
    useSubscriptionStore.setState({ isPro: false, isTeams: false, tier: "free", seatTeam: null } as never);
  });
  await handleRealtimeEvent("membership_changed:removed:t1", "dev");
  await vi.advanceTimersByTimeAsync(4_100);
  expect(toastMessages()).toContain("Your seat in Acme ended — cloud sync is paused. Your devices still sync on the same network.");
});

test("seat loss with an unknown team falls back to the generic wording", async () => {
  useTeamStore.setState({ teams: [] });
  h.load.mockImplementation(async () => {
    useSubscriptionStore.setState({ isPro: false, isTeams: false, tier: "free", seatTeam: null } as never);
  });
  await handleRealtimeEvent("plan_changed", "dev");
  await vi.advanceTimersByTimeAsync(4_100);
  expect(toastMessages()).toEqual(["Your Pro subscription has ended — cloud sync is paused. Your devices still sync on the same network."]);
});

test("the bare compat membership_changed event schedules a refresh", async () => {
  await handleRealtimeEvent("membership_changed", "dev");
  await vi.advanceTimersByTimeAsync(4_100);
  expect(h.refresh).toHaveBeenCalledTimes(1);
});

test("an unparseable membership_changed event still schedules a refresh", async () => {
  await handleRealtimeEvent("membership_changed:bogus", "dev");
  await vi.advanceTimersByTimeAsync(4_100);
  expect(h.refresh).toHaveBeenCalledTimes(1);
});

test("a failed refresh does not leave a stale team name for the next one", async () => {
  h.refresh.mockResolvedValueOnce("failed");
  await handleRealtimeEvent("plan_changed", "dev");
  await vi.advanceTimersByTimeAsync(4_100);
  useTeamStore.setState({ teams: [] });
  h.load.mockImplementation(async () => {
    useSubscriptionStore.setState({ isPro: false, isTeams: false, tier: "free", seatTeam: null } as never);
  });
  await handleRealtimeEvent("plan_changed", "dev");
  await vi.advanceTimersByTimeAsync(4_100);
  expect(toastMessages()).toEqual(["Your Pro subscription has ended — cloud sync is paused. Your devices still sync on the same network."]);
});
