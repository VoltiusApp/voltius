// @vitest-environment jsdom
import { test, expect } from "vitest";
import i18n from "@/i18n";
import { PLAN_FEATURES, freeForEveryone, planFeatureLabel, planFeaturesFor } from "./planFeatures";

const locales = import.meta.glob<{ settings: { account: { plan: { feature: Record<string, string> } } } }>(
  "../i18n/locales/*/settings.json",
  { eager: true, import: "default" },
);

const sharingLabel = (tier: keyof typeof PLAN_FEATURES) =>
  planFeatureLabel(i18n.t, PLAN_FEATURES[tier].find((f) => f.id === "terminalSharing")!);

test("terminal sharing labels carry each plan's server caps", () => {
  expect(sharingLabel("pro")).toBe("Terminal sharing: 1 session, 1 guest");
  expect(sharingLabel("teams")).toBe("Terminal sharing: 5 sessions, 10 guests each");
  expect(sharingLabel("business")).toBe("Terminal sharing: 20 sessions, 50 guests each");
});

test("free-for-everyone leaves out the vault limit, desktop-only rows on phones and LAN rows on iOS", () => {
  expect(freeForEveryone("linux").map((f) => f.id)).toEqual(["localSync", "deviceFiles", "syncPlugins", "cli", "machinePolicy", "auditLogs"]);
  expect(freeForEveryone("android").map((f) => f.id)).toEqual(["localSync", "deviceFiles", "syncPlugins", "auditLogs"]);
  expect(freeForEveryone("ios").map((f) => f.id)).toEqual(["syncPlugins", "auditLogs"]);
});

test("while the platform loads, the desktop and LAN rows show", () => {
  expect(planFeaturesFor("free", null).map((f) => f.id)).toEqual(expect.arrayContaining(["cli", "machinePolicy", "localSync"]));
});

test("every locale names the new free rows and drops MDM from enrolment", () => {
  for (const [path, json] of Object.entries(locales)) {
    if (path.includes("/pt-BR/")) continue;
    const feature = json.settings.account.plan.feature;
    expect(feature.cli, path).toContain("voltius-cli");
    expect(feature.machinePolicy, path).toBeTruthy();
    expect(feature.enrolment, path).not.toContain("MDM");
  }
});

test("every plan feature has an English label", () => {
  for (const f of Object.values(PLAN_FEATURES).flat()) {
    expect(planFeatureLabel(i18n.t, f)).not.toContain("settings.account");
  }
});

test("plan rows reuse each locale's enrolment-token and machine-policy terms", () => {
  const terms: Record<string, [string, string]> = {
    en: ["token", "machine policy"],
    cs: ["token", "zásady počítače"],
    fr: ["jeton", "règle machine"],
    pt: ["token", "política da máquina"],
    "pt-PT": ["token", "política da máquina"],
    ru: ["токен", "политика компьютера"],
    tr: ["belirteç", "makine politikası"],
    zh: ["令牌", "本机策略"],
  };
  for (const [locale, [token, policy]] of Object.entries(terms)) {
    const feature = locales[`../i18n/locales/${locale}/settings.json`].settings.account.plan.feature;
    expect(feature.enrolment.toLowerCase(), locale).toContain(token);
    expect(feature.machinePolicy.toLowerCase(), locale).toContain(policy);
  }
});
