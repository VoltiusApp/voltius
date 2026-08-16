import { describe, expect, test, vi, beforeEach } from "vitest";
import { subscription } from "./account";
import { useSubscriptionStore } from "@/stores/subscriptionStore";

describe("domaine account", () => {
  beforeEach(() => {
    useSubscriptionStore.setState({
      tier: "free", trialEndsAt: null, trialUsed: false, isTrialActive: false,
      accountMode: null, usedSeats: null, totalSeats: null,
      subscriptionStatus: null, subscriptionCancelled: false, renewsAt: null, endsAt: null,
      emailVerified: true, billingLoadFailed: false,
    });
  });
  test("rafraîchit avant de lire", async () => {
    const load = vi.fn(async () => {
      useSubscriptionStore.setState({ tier: "teams", usedSeats: 3, totalSeats: 5 });
    });
    useSubscriptionStore.setState({ tier: "free", usedSeats: null, totalSeats: null, load });

    const view = await subscription();

    expect(load).toHaveBeenCalledOnce();
    expect(view.tier).toBe("teams");
    expect(view.usedSeats).toBe(3);
    expect(view.totalSeats).toBe(5);
  });

  test("un échec d'enrichissement facturation (pro) signale stale=true", async () => {
    const load = vi.fn(async () => {
      useSubscriptionStore.setState({ tier: "pro", billingLoadFailed: true });
    });
    useSubscriptionStore.setState({ tier: "pro", load });

    const view = await subscription();

    expect(view.tier).toBe("pro");
    expect(view.stale).toBe(true);
  });

  test("les dates sortent en ISO, pas en objets Date", async () => {
    const when = new Date("2026-09-01T00:00:00.000Z");
    useSubscriptionStore.setState({
      load: vi.fn(async () => {}),
      tier: "pro", trialEndsAt: when, renewsAt: when, endsAt: null,
    });

    const view = await subscription();

    expect(view.trialEndsAt).toBe("2026-09-01T00:00:00.000Z");
    expect(view.renewsAt).toBe("2026-09-01T00:00:00.000Z");
    expect(view.endsAt).toBeNull();
  });

  test("free-tier account reports stale=false (pas d'enrichissement tenté)", async () => {
    useSubscriptionStore.setState({
      load: vi.fn(async () => {}),
      tier: "free", billingLoadFailed: false,
    });

    const view = await subscription();

    expect(view.tier).toBe("free");
    expect(view.stale).toBe(false);
  });

  test("pro account avec enrichissement réussi signale stale=false", async () => {
    const load = vi.fn(async () => {
      useSubscriptionStore.setState({ tier: "pro", usedSeats: 2, totalSeats: 5, billingLoadFailed: false });
    });
    useSubscriptionStore.setState({ tier: "pro", load });

    const view = await subscription();

    expect(view.tier).toBe("pro");
    expect(view.usedSeats).toBe(2);
    expect(view.stale).toBe(false);
  });
});
