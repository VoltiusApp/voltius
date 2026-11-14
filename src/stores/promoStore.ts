import { create } from "zustand";
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
  current: { promo: PromoId; source: PromoSource; context?: PaywallContext } | null;
  launchHandled: boolean;
  load(): Promise<void>;
  open(promo: PromoId, source: PromoSource, context?: PaywallContext): void;
  close(reason: "dismissed" | "activated"): void;
}

function occurrenceFor(promo: PromoId, state: PromoState | null): number | undefined {
  if (promo !== "plan_ended" || !state) return undefined;
  return (state.planEnded?.at ?? state.teamEnded?.at) ?? undefined;
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
    set({ current: { promo, source, ...(context && { context }) } });
    void recordPromoEvent(promo, "shown", source, occurrenceFor(promo, get().state));
  },

  close(reason) {
    const { current, state } = get();
    set({ current: null });
    if (current && reason === "dismissed") {
      void recordPromoEvent(current.promo, "dismissed", current.source, occurrenceFor(current.promo, state));
    }
  },
}));
