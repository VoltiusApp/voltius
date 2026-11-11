import type { TFunction } from "i18next";
import { guestCapFor, sessionCapFor } from "@/services/teamSharing";
import { TIER_RANK, type Tier } from "@/stores/subscriptionTier";
import { isMobilePlatform, runsLocalSync } from "@/utils/platform";

export interface PlanFeature {
  id: string;
  only?: (platform: string | null) => boolean;
  /** A free-tier limit that paid plans lift, so it is not listed as "free for everyone". */
  limit?: boolean;
  sessions?: number;
  guests?: number;
}

const hasMdm = (platform: string | null) => platform === "android" || platform === "ios" || platform === "macos";
const onDesktop = (platform: string | null) => !isMobilePlatform(platform);

const sharing = (tier: Tier): PlanFeature => ({
  id: "terminalSharing",
  sessions: sessionCapFor(tier),
  guests: guestCapFor(tier),
});

/** What each plan adds over the one below it. */
export const PLAN_FEATURES: Record<Tier, PlanFeature[]> = {
  free: [
    { id: "privateVault", limit: true },
    { id: "localSync", only: runsLocalSync },
    { id: "deviceFiles", only: runsLocalSync },
    { id: "syncPlugins" },
    { id: "cli", only: onDesktop },
    { id: "machinePolicy", only: onDesktop },
    { id: "mdm", only: hasMdm },
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

export function planFeaturesFor(tier: Tier, platform: string | null): PlanFeature[] {
  return PLAN_FEATURES[tier].filter((f) => !f.only || f.only(platform));
}

export function freeForEveryone(platform: string | null): PlanFeature[] {
  return planFeaturesFor("free", platform).filter((f) => !f.limit);
}

export function planFeatureLabel(t: TFunction, f: PlanFeature): string {
  return t(`settings.account.plan.feature.${f.id}`, { count: f.sessions, guests: f.guests });
}
