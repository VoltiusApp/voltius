import { expect, test } from "vitest";
import { SETTING_KEYS } from "@/services/user-data/settingKeys";
import { ANSI_SLOTS } from "@/utils/keywordMatcher";
import { policyKeys, isDefaultApplied, isPolicyEnforced, policyKeyDef, policyKeysSnapshot } from "./policyKeys";

test("every setting key has a policy type", () => {
  for (const k of SETTING_KEYS) expect(policyKeyDef(k.id)?.type).toBeDefined();
});

test("ids are unique", () => {
  expect(new Set(policyKeys().map((k) => k.id)).size).toBe(policyKeys().length);
});

test("toggles are bool and sync switches exist", () => {
  expect(policyKeyDef("appSettings.toggles.cursor-blink")?.type).toBe("bool");
  expect(policyKeyDef("sync.domains.appSettings")?.type).toBe("bool");
  expect(policyKeyDef("sync.types.key")?.type).toBe("bool");
  expect(policyKeyDef("sync.settings.appSettings.locale")?.type).toBe("bool");
  expect(policyKeyDef("server.url")?.type).toBe("string");
});

test("keys.json entries carry enforced", () => {
  const enforced = (id: string) => policyKeysSnapshot().find((k) => k.id === id)?.enforced;
  expect(enforced("appSettings.toggles.cursor-blink")).toBe(true);
  expect(enforced("server.url")).toBe(true);
  expect(enforced("appSettings.locale")).toBe(true);
  expect(enforced("appSettings.plugins.overrides")).toBe(false);
});

test("keys.json entries carry defaultApplied", () => {
  const applied = (id: string) => policyKeysSnapshot().find((k) => k.id === id)?.defaultApplied;
  expect(applied("appSettings.toggles.cursor-blink")).toBe(true);
  expect(applied("server.url")).toBe(true);
  expect(applied("appSettings.locale")).toBe(true);
  expect(applied("sync.domains.themes")).toBe(false);
  expect(applied("sshConfig.import")).toBe(false);
});

test("previous server urls are a lock-only list", () => {
  expect(policyKeyDef("server.previousUrls")?.type).toBe("stringList");
  expect(isPolicyEnforced("server.previousUrls")).toBe(true);
  expect(isDefaultApplied("server.previousUrls")).toBe(false);
});

test("plugin install keys are registered and enforced", () => {
  expect(policyKeyDef("plugins.install")?.type).toBe("stringList");
  expect(policyKeyDef("plugins.allowInstall")?.type).toBe("bool");
  expect(isPolicyEnforced("plugins.install")).toBe(true);
  expect(isPolicyEnforced("plugins.allowInstall")).toBe(true);
  for (const k of ["plugins.install", "plugins.enabled", "plugins.disabled"]) expect(isDefaultApplied(k)).toBe(true);
});

test("registry carries domains, ranges, locks and implied toggles", () => {
  const ttl = policyKeyDef("appSettings.detachedTtlHours");
  expect(ttl?.range).toEqual(["allowed", "min", "max"]);
  expect(ttl?.implies).toBe("appSettings.toggles.detached-session-ttl");
  const rules = policyKeyDef("appSettings.terminal.keywordRules");
  expect(rules?.lock).toBe("add");
  expect(rules?.domain?.colors).toEqual([...ANSI_SLOTS]);
  expect(policyKeyDef("appSettings.plugins.overrides")?.lock).toBe("never");
});

test("keys.json mirrors the registry", async () => {
  await expect(JSON.stringify(policyKeysSnapshot(), null, 2) + "\n").toMatchFileSnapshot("../../../src-tauri/src/policy/keys.json");
});

test("enrollment token is a policy-only enforced string", () => {
  expect(policyKeyDef("enrollment.token")).toMatchObject({ type: "string", lock: "only" });
  expect(isPolicyEnforced("enrollment.token")).toBe(true);
  expect(isDefaultApplied("enrollment.token")).toBe(false);
});
