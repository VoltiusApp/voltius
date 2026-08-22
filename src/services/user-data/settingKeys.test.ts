import { describe, test, expect } from "vitest";
import { SETTING_KEYS, settingKey, domainOf, relPath, keysForDomain } from "./settingKeys";
import { TOGGLE_DEFS, useToggleSettingsStore, type ToggleId } from "@/stores/toggleSettingsStore";
import { USER_DATA_HANDLERS } from "./registry";
import { hasPath } from "@/utils/dotPath";

describe("settingKeys", () => {
  test("declares one key per toggle plus the hand-written ones", () => {
    const toggleKeys = SETTING_KEYS.filter((k) => k.id.startsWith("appSettings.toggles."));
    expect(toggleKeys).toHaveLength(Object.keys(TOGGLE_DEFS).length);
    for (const [id, def] of Object.entries(TOGGLE_DEFS)) {
      expect(settingKey(`appSettings.toggles.${id}`)?.labelKey).toBe(def.labelKey);
    }
  });

  test("marks exactly the two device-scoped keys", () => {
    expect(SETTING_KEYS.filter((k) => k.deviceScoped).map((k) => k.id).sort())
      .toEqual(["appSettings.terminal.preferredShell", "themes.location"]);
  });

  test("splits an id into its domain and the path within the section", () => {
    expect(domainOf("appSettings.terminal.cursorStyle")).toBe("appSettings");
    expect(relPath("appSettings.terminal.cursorStyle")).toBe("terminal.cursorStyle");
    expect(relPath("themes.location")).toBe("location");
  });

  test("groups keys by domain", () => {
    expect(keysForDomain("themes").map((k) => k.id)).toEqual(["themes.location"]);
    expect(keysForDomain("uiPreferences")).toEqual([]);
  });

  test("ids are unique", () => {
    expect(new Set(SETTING_KEYS.map((k) => k.id)).size).toBe(SETTING_KEYS.length);
  });

  // Registry drift: a renamed or dropped field in a handler's export() must
  // fail here rather than silently produce a control that filters nothing.
  test("every declared id resolves in its handler's export()", () => {
    // Toggles are absent from the store until the user changes one, so seed
    // every id first — the registry claims the PATH exists, not that it is set.
    const values = Object.fromEntries(
      Object.entries(TOGGLE_DEFS).map(([id, def]) => [id, def.default]),
    ) as Partial<Record<ToggleId, boolean>>;
    useToggleSettingsStore.setState({ values });

    for (const key of SETTING_KEYS) {
      const handler = USER_DATA_HANDLERS.find((h) => h.key === domainOf(key.id));
      expect(handler, `no handler for ${key.id}`).toBeDefined();
      expect(hasPath(handler!.export(), relPath(key.id)), `${key.id} missing from export()`).toBe(true);
    }
  });
});
