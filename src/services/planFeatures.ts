import type { TFunction } from "i18next";
import { guestCapFor, sessionCapFor } from "@/services/teamSharing";
import { TIER_RANK, type Tier } from "@/stores/subscriptionTier";

export interface PlanFeature {
  id: string;
  /** Only where local network sync runs (not iOS). */
  lan?: boolean;
  /** A free-tier limit that paid plans lift, so it is not listed as "free for everyone". */
  limit?: boolean;
  sessions?: number;
  guests?: number;
}

const sharing = (tier: Tier): PlanFeature => ({
  id: "terminalSharing",
  sessions: sessionCapFor(tier),
  guests: guestCapFor(tier),
});

/** What each plan adds over the one below it. */
export const PLAN_FEATURES: Record<Tier, PlanFeature[]> = {
  free: [
    { id: "privateVault", limit: true },
    { id: "localSync", lan: true },
    { id: "deviceFiles", lan: true },
    { id: "syncPlugins" },
    { id: "auditLogs" },
  ],
  pro: [
    { id: "cloudSync" },
    { id: "cloudBackup" },
    { id: "crossDeviceSessions" },
    { id: "unlimitedVaults" },
    sharing("pro"),
  ],
  teams: [{ id: "teamVaults" }, { id: "builtInRoles" }, { id: "teamAuditLogs" }, sharing("teams")],
  business: [
    { id: "granularPermissions" },
    { id: "teamPolicy" },
    { id: "enrolment" },
    sharing("business"),
    { id: "commercialLicense" },
    { id: "prioritySupport" },
  ],
};

const TIERS = (Object.keys(TIER_RANK) as Tier[]).sort((a, b) => TIER_RANK[a] - TIER_RANK[b]);

export function adjacentPlan(tier: Tier, step: 1 | -1): Tier | null {
  return TIERS[TIER_RANK[tier] + step] ?? null;
}

export function planFeaturesFor(tier: Tier, localSync: boolean): PlanFeature[] {
  return PLAN_FEATURES[tier].filter((f) => localSync || !f.lan);
}

export function freeForEveryone(localSync: boolean): PlanFeature[] {
  return planFeaturesFor("free", localSync).filter((f) => !f.limit);
}

export function planFeatureLabel(t: TFunction, f: PlanFeature): string {
  return t(`settings.account.plan.feature.${f.id}`, { count: f.sessions, guests: f.guests });
}
