import { describe, test, expect } from "vitest";
import { SETTING_KEYS } from "@/services/user-data/settingKeys";

describe("syncKey props", () => {
  test("every syncKey in the settings UI is a declared setting key", () => {
    const sources = import.meta.glob("./*.tsx", { eager: true, query: "?raw", import: "default" }) as
      Record<string, string>;
    const used = Object.entries(sources)
      .filter(([path]) => !path.endsWith(".test.tsx"))
      // Both ways a component names a setting key: the SettingRow prop and a
      // stand-alone SyncKeyButton, for controls that are not rows.
      .flatMap(([, text]) => [
        ...[...text.matchAll(/syncKey="([^"]+)"/g)].map((m) => m[1]),
        ...[...text.matchAll(/<SyncKeyButton path="([^"]+)"/g)].map((m) => m[1]),
      ]);
    const declared = new Set(SETTING_KEYS.map((k) => k.id));
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((id) => !declared.has(id))).toEqual([]);
  });
});
