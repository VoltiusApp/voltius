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
  await vi.advanceTimersByTimeAsync(1_100);
  expect(h.refresh).toHaveBeenCalledTimes(1);
  expect(h.load).toHaveBeenCalled();
});

test("a burst of plan and membership events refreshes once", async () => {
  await handleRealtimeEvent("plan_changed", "dev");
  await handleRealtimeEvent("plan_changed", "dev");
  await handleRealtimeEvent("membership_changed:added:t2", "dev");
  await vi.advanceTimersByTimeAsync(1_100);
  expect(h.refresh).toHaveBeenCalledTimes(1);
});

test("membership_removed_refreshes_token", async () => {
  await handleRealtimeEvent("membership_changed:removed:t1", "dev");
  await vi.advanceTimersByTimeAsync(1_100);
  expect(h.refresh).toHaveBeenCalledTimes(1);
});

test("seat_loss_toast_names_the_team", async () => {
  h.load.mockImplementation(async () => {
    useSubscriptionStore.setState({ isPro: false, isTeams: false, tier: "free", seatTeam: null } as never);
  });
  await handleRealtimeEvent("membership_changed:removed:t1", "dev");
  await vi.advanceTimersByTimeAsync(1_100);
  expect(toastMessages()).toContain("Your seat in Acme ended — sync has been paused.");
});

test("seat loss with an unknown team falls back to the generic wording", async () => {
  useTeamStore.setState({ teams: [] });
  h.load.mockImplementation(async () => {
    useSubscriptionStore.setState({ isPro: false, isTeams: false, tier: "free", seatTeam: null } as never);
  });
  await handleRealtimeEvent("plan_changed", "dev");
  await vi.advanceTimersByTimeAsync(1_100);
  expect(toastMessages()).toEqual(["Your Pro subscription has ended — sync has been paused."]);
});
