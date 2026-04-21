import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export type Tier = "free" | "pro" | "teams" | "business";

interface JwtPayload {
  tier?: string;
  trial_ends_at?: number; // unix timestamp
  trial_used?: boolean;
}

function parseJwtPayload(token: string): JwtPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const raw = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(raw) as JwtPayload;
  } catch {
    return null;
  }
}

async function keychainGet(key: string): Promise<string | null> {
  return invoke<string | null>("keychain_get", { key });
}

export interface SubscriptionState {
  tier: Tier;
  trialEndsAt: Date | null;
  trialUsed: boolean;
  isTrialActive: boolean;
  isPro: boolean;
  isTeams: boolean;
  load: () => Promise<void>;
}

export const useSubscriptionStore = create<SubscriptionState>((set) => ({
  tier: "free",
  trialEndsAt: null,
  trialUsed: false,
  isTrialActive: false,
  isPro: false,
  isTeams: false,

  async load() {
    const mode = await keychainGet("mode").catch(() => null);
    if (mode !== "server") {
      // Local accounts have no subscription
      set({ tier: "free", trialEndsAt: null, trialUsed: false, isTrialActive: false, isPro: false, isTeams: false });
      return;
    }

    const jwt = await keychainGet("jwt").catch(() => null);
    if (!jwt) {
      set({ tier: "free", trialEndsAt: null, trialUsed: false, isTrialActive: false, isPro: false, isTeams: false });
      return;
    }

    const payload = parseJwtPayload(jwt);
    if (!payload) {
      set({ tier: "free", trialEndsAt: null, trialUsed: false, isTrialActive: false, isPro: false, isTeams: false });
      return;
    }

    const tier = (payload.tier as Tier) ?? "free";
    const trialEndsAt = payload.trial_ends_at ? new Date(payload.trial_ends_at * 1000) : null;
    const trialUsed = payload.trial_used ?? false;
    const now = new Date();
    const isTrialActive = tier === "pro" && trialEndsAt != null && trialEndsAt > now;
    const isPro = tier !== "free";
    const isTeams = tier === "teams" || tier === "business";

    set({ tier, trialEndsAt, trialUsed, isTrialActive, isPro, isTeams });
  },
}));

export function useSubscription() {
  return useSubscriptionStore();
}
