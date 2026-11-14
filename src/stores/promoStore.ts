import { create } from "zustand";
import { pendingPlanEndOccurrence } from "@/services/promoPicker";
import {
  fetchPromoState,
  recordPromoEvent,
  type PaywallContext,
  type PromoId,
  type PromoSource,
  type PromoState,
} from "@/services/promos";

interface PromoStore {
  state: PromoState | null;
  current: { promo: PromoId; source: PromoSource; context?: PaywallContext; occurrence?: number } | null;
  launchHandled: boolean;
  load(): Promise<void>;
  open(promo: PromoId, source: PromoSource, context?: PaywallContext): void;
  close(reason: "dismissed" | "activated"): void;
}

function occurrenceFor(promo: PromoId, state: PromoState | null): number | undefined {
  if (promo !== "plan_ended" || !state) return undefined;
  return pendingPlanEndOccurrence(state) ?? undefined;
}

export const usePromoStore = create<PromoStore>((set, get) => ({
  state: null,
  current: null,
  launchHandled: false,

  async load() {
    const state = await fetchPromoState();
    if (state) set({ state });
  },

  open(promo, source, context) {
    const occurrence = occurrenceFor(promo, get().state);
    set({ current: { promo, source, ...(context && { context }), ...(occurrence !== undefined && { occurrence }) } });
    void recordPromoEvent(promo, "shown", source, occurrence);
  },

  close(reason) {
    const { current } = get();
    set({ current: null });
    if (current && reason === "dismissed") {
      void recordPromoEvent(current.promo, "dismissed", current.source, current.occurrence);
    }
  },
}));
