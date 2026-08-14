import { describe, expect, test } from "vitest";
import { settingDef, settingDefs } from "./settingsManifest";
import { TOGGLE_DEFS } from "@/stores/toggleSettingsStore";
import { SYNC_OBJECT_TYPES } from "@/stores/syncPrefsStore";

describe("settingsManifest", () => {
  test("génère une entrée par bascule, depuis TOGGLE_DEFS", () => {
    const keys = settingDefs().map((d) => d.key);
    for (const id of Object.keys(TOGGLE_DEFS)) {
      expect(keys).toContain(`toggles.${id}`);
    }
  });

  test("génère une entrée booléenne par type synchronisable", () => {
    for (const t of SYNC_OBJECT_TYPES) {
      const def = settingDef(`sync.type.${t.id}`);
      expect(def).toBeDefined();
      expect(def!.type).toBe("boolean");
      expect(def!.default).toBe(true);
    }
  });

  test("les clés sont uniques", () => {
    const keys = settingDefs().map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("toute entrée écrivable porte un setter, et l'inverse", () => {
    for (const d of settingDefs()) {
      expect(typeof d.set === "function").toBe(d.writable);
    }
  });

  test("les valeurs structurées sont listées mais non écrivables", () => {
    const shortcut = settingDefs().find((d) => d.key.startsWith("shortcuts."));
    expect(shortcut).toBeDefined();
    expect(shortcut!.type).toBe("structured");
    expect(shortcut!.writable).toBe(false);
  });

  test("les deux clés qui désarment un garde-fou portent une conséquence", () => {
    expect(settingDef("toggles.plugin-install-review")!.consequence)
      .toBe("settings.mcp.consequence.pluginInstallReview");
    expect(settingDef("security.sessionTimeoutMinutes")!.consequence)
      .toBe("settings.mcp.consequence.sessionTimeout");
  });

  test("aucune autre clé ne porte de conséquence", () => {
    const guarded = settingDefs().filter((d) => d.consequence).map((d) => d.key);
    expect(guarded.sort()).toEqual([
      "security.sessionTimeoutMinutes",
      "toggles.plugin-install-review",
    ]);
  });

  test("les enums dynamiques sont calculés à l'appel, pas figés", () => {
    const def = settingDef("theme.activeThemeId")!;
    expect(def.type).toBe("enum");
    expect(def.values!.length).toBeGreaterThan(0);
  });

  test("keepalivePreset expose ses quatre valeurs", () => {
    expect(settingDef("connectivity.keepalivePreset")!.values!.slice().sort())
      .toEqual(["balanced", "fast", "off", "tolerant"]);
  });

  test("chaque entrée nomme une section réelle de l'écran Settings", () => {
    const sections = new Set([
      "appearance", "account", "sync", "vaults", "plugins", "integrations",
      "terminal", "sftp", "portForwarding", "hosts", "shortcuts", "diagnostics", "about",
    ]);
    for (const d of settingDefs()) expect(sections.has(d.section)).toBe(true);
  });
});
