import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { appFetch } from "@/services/http";
import { parseJwtPayload } from "@/utils/emailVerification";
import { deriveTierFlags, type Tier } from "@/stores/subscriptionTier";

export type { Tier };

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
  /** Seats purchased. What the buy-seats UI prices — never what an invite is checked against. */
  totalSeats: number | null;
  /** The cap the server enforces on invites: an active trial clamps it to 10 however
   *  many seats were purchased. `null` means uncapped (or unknown), so a pre-check
   *  must not block on it. Compare with `totalSeats` to explain the gap. */
  effectiveSeats: number | null;
  subscriptionStatus: string | null;
  subscriptionCancelled: boolean;
  renewsAt: Date | null;
  endsAt: Date | null;
  emailVerified: boolean;
  billingLoadFailed: boolean;
  load: () => Promise<void>;
}

/** Everything `load` derives from the server or the JWT, back to "nothing known".
 *  Spread into each early return so a new field cannot be reset in one path and
 *  left stale in another. */
const CLEARED = {
  tier: "free" as Tier,
  trialEndsAt: null,
  trialUsed: false,
  trialKnown: false,
  isTrialActive: false,
  isPro: false,
  isTeams: false,
  isBusiness: false,
  usedSeats: null,
  totalSeats: null,
  effectiveSeats: null,
  subscriptionStatus: null,
  subscriptionCancelled: false,
  renewsAt: null,
  endsAt: null,
  emailVerified: true,
  billingLoadFailed: false,
};

export const useSubscriptionStore = create<SubscriptionState>((set) => ({
  ...CLEARED,
  accountMode: null,

  async load() {
    const mode = await keychainGet("mode").catch(() => null);
    if (mode !== "server") {
      set({ ...CLEARED, accountMode: mode });
      return;
    }

    const jwt = await keychainGet("jwt").catch(() => null);
    if (!jwt) {
      set({ ...CLEARED });
      return;
    }

    const payload = parseJwtPayload<JwtPayload>(jwt);
    if (!payload) {
      set({ ...CLEARED });
      return;
    }

    const now = new Date();
    const { tier, trialEndsAt, trialKnown, trialUsed, isTrialActive, isPro, isTeams, isBusiness, emailVerified } =
      deriveTierFlags(payload, now);

    set({ ...CLEARED, tier, trialEndsAt, trialUsed, trialKnown, isTrialActive, isPro, isTeams, isBusiness, accountMode: mode, emailVerified });

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
              effective_seats?: number | null;
              status?: string | null;
              cancelled?: boolean;
              renews_at?: number | null;
              ends_at?: number | null;
            };
            set({
              usedSeats: data.used_seats ?? null,
              totalSeats: data.seats ?? null,
              effectiveSeats: data.effective_seats ?? null,
              subscriptionStatus: data.status ?? null,
              subscriptionCancelled: data.cancelled ?? false,
              renewsAt: data.renews_at ? new Date(data.renews_at * 1000) : null,
              endsAt: data.ends_at ? new Date(data.ends_at * 1000) : null,
              billingLoadFailed: false,
            });
          } else {
            set({ billingLoadFailed: true });
          }
        }
      } catch {
        set({ billingLoadFailed: true });
      }
    }
  },
}));

export function useSubscription() {
  return useSubscriptionStore();
}
