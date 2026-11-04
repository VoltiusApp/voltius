import { expect, test } from "vitest";
import { SETTING_KEYS } from "@/services/user-data/settingKeys";
import { POLICY_KEYS, policyKeyDef, policyKeysSnapshot } from "./policyKeys";

test("every setting key has a policy type", () => {
  for (const k of SETTING_KEYS) expect(policyKeyDef(k.id)?.type).toBeDefined();
});

test("ids are unique", () => {
  expect(new Set(POLICY_KEYS.map((k) => k.id)).size).toBe(POLICY_KEYS.length);
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
  expect(enforced("appSettings.locale")).toBe(false);
});

test("keys.json mirrors the registry", async () => {
  await expect(JSON.stringify(policyKeysSnapshot(), null, 2) + "\n").toMatchFileSnapshot("../../../src-tauri/src/policy/keys.json");
});
