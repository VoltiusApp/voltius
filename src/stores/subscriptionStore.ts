import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { appFetch } from "@/services/http";
import { parseJwtPayload } from "@/utils/emailVerification";
import { deriveTierFlags } from "@/stores/subscriptionTier";

export type Tier = "free" | "pro" | "teams" | "business";

interface JwtPayload {
  tier?: string;
  trial_ends_at?: number; // unix timestamp
  trial_used?: boolean;
  email_verified?: boolean;
}

async function keychainGet(key: string): Promise<string | null> {
  return invoke<string | null>("keychain_get", { key });
}

export interface SubscriptionState {
  tier: Tier;
  trialEndsAt: Date | null;
  trialUsed: boolean;
  trialKnown: boolean;
  isTrialActive: boolean;
  isPro: boolean;
  isTeams: boolean;
  isBusiness: boolean;
  accountMode: string | null;
  usedSeats: number | null;
  totalSeats: number | null;
  subscriptionStatus: string | null;
  subscriptionCancelled: boolean;
  renewsAt: Date | null;
  endsAt: Date | null;
  emailVerified: boolean;
  load: () => Promise<void>;
}

export const useSubscriptionStore = create<SubscriptionState>((set) => ({
  tier: "free",
  trialEndsAt: null,
  trialUsed: false,
  trialKnown: false,
  isTrialActive: false,
  isPro: false,
  isTeams: false,
  isBusiness: false,
  accountMode: null,
  usedSeats: null,
  totalSeats: null,
  subscriptionStatus: null,
  subscriptionCancelled: false,
  renewsAt: null,
  endsAt: null,
  emailVerified: true,

  async load() {
    const mode = await keychainGet("mode").catch(() => null);
    if (mode !== "server") {
      set({ tier: "free", trialEndsAt: null, trialUsed: false, trialKnown: false, isTrialActive: false, isPro: false, isTeams: false, isBusiness: false, accountMode: mode, usedSeats: null, totalSeats: null, subscriptionStatus: null, subscriptionCancelled: false, renewsAt: null, endsAt: null, emailVerified: true });
      return;
    }

    const jwt = await keychainGet("jwt").catch(() => null);
    if (!jwt) {
      set({ tier: "free", trialEndsAt: null, trialUsed: false, trialKnown: false, isTrialActive: false, isPro: false, isTeams: false, isBusiness: false, usedSeats: null, totalSeats: null, subscriptionStatus: null, subscriptionCancelled: false, renewsAt: null, endsAt: null, emailVerified: true });
      return;
    }

    const payload = parseJwtPayload<JwtPayload>(jwt);
    if (!payload) {
      set({ tier: "free", trialEndsAt: null, trialUsed: false, trialKnown: false, isTrialActive: false, isPro: false, isTeams: false, isBusiness: false, usedSeats: null, totalSeats: null, subscriptionStatus: null, subscriptionCancelled: false, renewsAt: null, endsAt: null, emailVerified: true });
      return;
    }

    const now = new Date();
    const { tier, trialEndsAt, trialKnown, trialUsed, isTrialActive, isPro, isTeams, isBusiness, emailVerified } =
      deriveTierFlags(payload, now);

    set({ tier, trialEndsAt, trialUsed, trialKnown, isTrialActive, isPro, isTeams, isBusiness, accountMode: mode, usedSeats: null, totalSeats: null, subscriptionStatus: null, subscriptionCancelled: false, renewsAt: null, endsAt: null, emailVerified });

    // Non-fatal: enrich paid plans with live billing lifecycle and seat data.
    if (isPro) {
      try {
        const serverUrl = await keychainGet("server_url").catch(() => null);
        if (serverUrl) {
          const res = await appFetch(`${serverUrl}/v1/billing/subscription`, {
            headers: { Authorization: `Bearer ${jwt}` },
          });
          if (res.ok) {
            const data = await res.json() as {
              used_seats?: number | null;
              seats?: number | null;
              status?: string | null;
              cancelled?: boolean;
              renews_at?: number | null;
              ends_at?: number | null;
            };
            set({
              usedSeats: data.used_seats ?? null,
              totalSeats: data.seats ?? null,
              subscriptionStatus: data.status ?? null,
              subscriptionCancelled: data.cancelled ?? false,
              renewsAt: data.renews_at ? new Date(data.renews_at * 1000) : null,
              endsAt: data.ends_at ? new Date(data.ends_at * 1000) : null,
            });
          }
        }
      } catch {
        // Non-fatal: lifecycle and seats display will just be empty
      }
    }
  },
}));

export function useSubscription() {
  return useSubscriptionStore();
}
