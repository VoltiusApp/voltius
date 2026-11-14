// Trials are granted by the server (POST /v1/billing/trial); the client only shows them.
// Must match the free-trial length configured on the Teams LemonSqueezy variants.
export const TEAMS_TRIAL_DAYS = 14;

// USD per seat per month; keep in step with web/shared/plans.ts (annualPrice / monthlyPrice).
export const PLAN_PRICES = {
  pro: { annual: 7, monthly: 9 },
  teams: { annual: 15, monthly: 18 },
} as const;
