// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

const h = vi.hoisted(() => {
  const ui = { whatsNewOpen: false, cloudAuthOpen: false };
  const listeners = new Set<() => void>();
  return {
    ui,
    listeners,
    subLoad: vi.fn(),
    promoLoad: vi.fn(),
    open: vi.fn(),
    refresh: vi.fn(),
    billing: { value: false },
    promoState: { current: null as unknown },
    launchHandled: { value: false },
    accountMode: { value: "server" as string | null },
  };
});

vi.mock("@/stores/uiStore", async () => {
  const React = await import("react");
  const useUIStore = Object.assign(
    (sel: (s: typeof h.ui) => unknown) => {
      const [, force] = React.useReducer((x: number) => x + 1, 0);
      React.useEffect(() => {
        h.listeners.add(force as () => void);
        return () => { h.listeners.delete(force as () => void); };
      }, []);
      return sel(h.ui);
    },
    { getState: () => h.ui },
  );
  return { useUIStore };
});
vi.mock("@/stores/subscriptionStore", async () => {
  const React = await import("react");
  const snap = () => ({
    load: h.subLoad,
    accountMode: h.accountMode.value,
    tier: "free",
    billingTier: "free",
    seatTeam: null,
  });
  const useSubscriptionStore = Object.assign(
    (sel: (s: ReturnType<typeof snap>) => unknown) => {
      const [, force] = React.useReducer((x: number) => x + 1, 0);
      React.useEffect(() => {
        h.listeners.add(force as () => void);
        return () => { h.listeners.delete(force as () => void); };
      }, []);
      return sel(snap());
    },
    { getState: snap },
  );
  return { useSubscriptionStore };
});
vi.mock("@/stores/promoStore", () => ({
  usePromoStore: {
    getState: () => ({
      load: h.promoLoad,
      open: h.open,
      state: h.promoState.current,
      launchHandled: h.launchHandled.value,
    }),
    setState: (p: { launchHandled?: boolean; state?: unknown }) => {
      if (p.launchHandled !== undefined) h.launchHandled.value = p.launchHandled;
      if ("state" in p) h.promoState.current = p.state;
    },
  },
}));
vi.mock("@/services/serverCapabilities", () => ({
  getServerCapability: () => h.billing.value,
  refreshServerCapabilities: h.refresh,
}));
vi.mock("@/services/distribution", () => ({ CAN_OPEN_CHECKOUT: true }));

import { useLaunchPromo } from "./useLaunchPromo";

const STATE = {
  proTrialAvailable: true,
  teamsTrialAvailable: false,
  emailVerified: true,
  seen: [],
  planEnded: null,
  teamEnded: null,
  paymentIssue: null,
};

const setUi = (p: Partial<typeof h.ui>) => {
  Object.assign(h.ui, p);
  h.listeners.forEach((l) => l());
};
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
  vi.clearAllMocks();
  h.ui.whatsNewOpen = false;
  h.ui.cloudAuthOpen = false;
  h.billing.value = true;
  h.launchHandled.value = false;
  h.accountMode.value = "server";
  h.promoState.current = STATE;
  h.subLoad.mockResolvedValue(undefined);
  h.promoLoad.mockResolvedValue(undefined);
  h.refresh.mockResolvedValue(undefined);
});

afterEach(() => cleanup());

test("waits_for_whats_new_then_picks", async () => {
  h.ui.whatsNewOpen = true;
  renderHook(() => useLaunchPromo(true));
  await flush();
  expect(h.open).not.toHaveBeenCalled();
  expect(h.launchHandled.value).toBe(false);
  setUi({ whatsNewOpen: false });
  await flush();
  expect(h.open).toHaveBeenCalledWith("pro_redeem", "launch");
});

test("modal_opening_mid_load_defers_pick", async () => {
  let release!: () => void;
  h.promoLoad.mockReturnValue(new Promise<void>((r) => { release = r; }));
  renderHook(() => useLaunchPromo(true));
  await flush();
  setUi({ whatsNewOpen: true });
  release();
  await flush();
  expect(h.open).not.toHaveBeenCalled();
  expect(h.launchHandled.value).toBe(false);
  setUi({ whatsNewOpen: false });
  await flush();
  expect(h.open).toHaveBeenCalledTimes(1);
});

test("signs_in_mid_session_then_loads_and_picks", async () => {
  h.accountMode.value = null;
  h.promoState.current = { ...STATE, proTrialAvailable: false };
  h.promoLoad.mockImplementation(async () => {
    if (h.accountMode.value === "server") h.promoState.current = STATE;
  });
  renderHook(() => useLaunchPromo(true));
  await flush();
  expect(h.open).not.toHaveBeenCalled();
  expect(h.launchHandled.value).toBe(false);
  expect(h.promoState.current).toBeNull();

  setUi({ cloudAuthOpen: true });
  h.accountMode.value = "server";
  setUi({});
  await flush();
  expect(h.open).not.toHaveBeenCalled();

  setUi({ cloudAuthOpen: false });
  await flush();
  expect(h.promoState.current).toEqual(STATE);
  expect(h.open).toHaveBeenCalledWith("pro_redeem", "launch");
  expect(h.launchHandled.value).toBe(true);
});

test("reloads_promo_state_on_later_sign_in", async () => {
  renderHook(() => useLaunchPromo(true));
  await flush();
  expect(h.launchHandled.value).toBe(true);
  h.accountMode.value = "local";
  setUi({});
  await flush();
  expect(h.promoState.current).toBeNull();
  h.promoLoad.mockClear();
  h.accountMode.value = "server";
  setUi({});
  await flush();
  expect(h.promoLoad).toHaveBeenCalledTimes(1);
});

test("late_billing_meta_still_picks", async () => {
  h.billing.value = false;
  h.refresh.mockImplementation(async () => {
    await new Promise((r) => setTimeout(r, 20));
    h.billing.value = true;
  });
  renderHook(() => useLaunchPromo(true));
  await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
  expect(h.open).toHaveBeenCalledWith("pro_redeem", "launch");
});
