import { describe, expect, test, vi } from "vitest";
import { subscription } from "./account";
import { useSubscriptionStore } from "@/stores/subscriptionStore";

describe("domaine account", () => {
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

  test("un échec de rafraîchissement n'est pas fatal : la vue reste lisible", async () => {
    const load = vi.fn(async () => { throw new Error("offline"); });
    useSubscriptionStore.setState({ tier: "pro", load, trialEndsAt: null, endsAt: null, renewsAt: null });

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
});
