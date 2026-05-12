import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { appFetch } from "@/services/http";

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
  isBusiness: boolean;
  accountMode: string | null;
  usedSeats: number | null;
  totalSeats: number | null;
  load: () => Promise<void>;
}

export const useSubscriptionStore = create<SubscriptionState>((set) => ({
  tier: "free",
  trialEndsAt: null,
  trialUsed: false,
  isTrialActive: false,
  isPro: false,
  isTeams: false,
  isBusiness: false,
  accountMode: null,
  usedSeats: null,
  totalSeats: null,

  async load() {
    const mode = await keychainGet("mode").catch(() => null);
    if (mode !== "server") {
      set({ tier: "free", trialEndsAt: null, trialUsed: false, isTrialActive: false, isPro: false, isTeams: false, isBusiness: false, accountMode: mode, usedSeats: null, totalSeats: null });
      return;
    }

    const jwt = await keychainGet("jwt").catch(() => null);
    if (!jwt) {
      set({ tier: "free", trialEndsAt: null, trialUsed: false, isTrialActive: false, isPro: false, isTeams: false, isBusiness: false, usedSeats: null, totalSeats: null });
      return;
    }

    const payload = parseJwtPayload(jwt);
    if (!payload) {
      set({ tier: "free", trialEndsAt: null, trialUsed: false, isTrialActive: false, isPro: false, isTeams: false, isBusiness: false, usedSeats: null, totalSeats: null });
      return;
    }

    const tier = (payload.tier as Tier) ?? "free";
    const trialEndsAt = payload.trial_ends_at ? new Date(payload.trial_ends_at * 1000) : null;
    const trialUsed = payload.trial_used ?? false;
    const now = new Date();
    const isTrialActive = tier === "pro" && trialEndsAt != null && trialEndsAt > now;
    const isPro = tier !== "free";
    const isTeams = tier === "teams" || tier === "business";
    const isBusiness = tier === "business";

    set({ tier, trialEndsAt, trialUsed, isTrialActive, isPro, isTeams, isBusiness, accountMode: mode, usedSeats: null, totalSeats: null });

    // For Teams/Business, fetch live seat usage from API
    if (isTeams) {
      try {
        const serverUrl = await keychainGet("server_url").catch(() => null);
        if (serverUrl) {
          const res = await appFetch(`${serverUrl}/v1/billing/subscription`, {
            headers: { Authorization: `Bearer ${jwt}` },
          });
          if (res.ok) {
            const data = await res.json() as { used_seats?: number | null; seats?: number | null };
            set({ usedSeats: data.used_seats ?? null, totalSeats: data.seats ?? null });
          }
        }
      } catch {
        // Non-fatal: seats display will just be empty
      }
    }
  },
}));

export function useSubscription() {
  return useSubscriptionStore();
}
