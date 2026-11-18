// @vitest-environment jsdom
import { test, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  refresh: vi.fn(),
  load: vi.fn(),
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

const PRO_ENDED = "Your Pro subscription has ended — cloud sync is paused. Your devices still sync on the same network.";
const SEAT_ENDED = "Your seat in Acme ended — cloud sync is paused. Your devices still sync on the same network.";

const asFree = () =>
  useSubscriptionStore.setState({ isPro: false, isTeams: false, isBusiness: false, tier: "free", seatTeam: null } as never);
const asPro = () =>
  useSubscriptionStore.setState({ isPro: true, isTeams: false, isBusiness: false, tier: "pro", seatTeam: null } as never);
const asSeat = () =>
  useSubscriptionStore.setState({ isPro: true, isTeams: true, isBusiness: false, tier: "teams", seatTeam: { id: "t1", trial: false } } as never);

/** Each entry is one `load()` call: the state it leaves and where that state came from. */
function loads(...steps: Array<[() => void, "jwt" | "cleared"]>) {
  let i = 0;
  h.load.mockImplementation(async () => {
    const [apply, source] = steps[Math.min(i++, steps.length - 1)];
    apply();
    return source;
  });
}

let random: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  random = vi.spyOn(Math, "random").mockReturnValue(0);
  h.refresh.mockReset();
  h.refresh.mockResolvedValue({ jwt: "x.y.z" });
  h.load.mockReset();
  useSubscriptionStore.setState({ load: h.load } as never);
  asPro();
  useTeamStore.setState({ teams: [{ id: "t1", name: "Acme", role_ids: [] } as never] });
  useNotificationStore.setState({ toasts: [] });
});

afterEach(() => {
  random.mockRestore();
  vi.useRealTimers();
});

const toastMessages = () => useNotificationStore.getState().toasts.map((t) => t.message);

async function refreshAndSettle() {
  await handleRealtimeEvent("plan_changed", "dev");
  await vi.advanceTimersByTimeAsync(10_000);
}

test("no_pro_expired_toast_when_reload_clears_transiently", async () => {
  loads([asFree, "cleared"], [asPro, "jwt"]);
  await refreshAndSettle();
  expect(toastMessages()).toEqual([]);
  expect(useSubscriptionStore.getState().isPro).toBe(true);
});

test("no_pro_expired_toast_when_state_not_from_jwt", async () => {
  loads([asFree, "cleared"]);
  await refreshAndSettle();
  expect(toastMessages()).toEqual([]);
});

test("no_pro_expired_toast_when_confirming_jwt_load_is_pro_again", async () => {
  loads([asFree, "jwt"], [asPro, "jwt"]);
  await refreshAndSettle();
  expect(toastMessages()).toEqual([]);
});

test("pro_expired_toast_when_downgrade_confirmed", async () => {
  loads([asFree, "jwt"], [asFree, "jwt"]);
  await handleRealtimeEvent("plan_changed", "dev");
  await vi.advanceTimersByTimeAsync(1_000);
  expect(toastMessages()).toEqual([]);
  await vi.advanceTimersByTimeAsync(9_000);
  expect(h.load).toHaveBeenCalledTimes(2);
  expect(toastMessages()).toEqual([PRO_ENDED]);
});

test("seat_ended_toast_only_when_confirmed", async () => {
  asSeat();
  loads([asFree, "cleared"], [asSeat, "jwt"]);
  await handleRealtimeEvent("plan_changed", "dev");
  await vi.advanceTimersByTimeAsync(10_000);
  expect(toastMessages()).toEqual([]);

  asSeat();
  h.load.mockReset();
  loads([asFree, "jwt"], [asFree, "jwt"]);
  await handleRealtimeEvent("plan_changed", "dev");
  await vi.advanceTimersByTimeAsync(10_000);
  expect(toastMessages()).toEqual([SEAT_ENDED]);
});
