import { describe, expect, test } from "vitest";
import i18n from "@/i18n";
import { GUARDED, settingDef, settingDefs, TOGGLE_SECTION } from "./settingsManifest";
import { TOGGLE_DEFS } from "@/stores/toggleSettingsStore";
import { SYNC_OBJECT_TYPES } from "@/stores/syncPrefsStore";
import { useThemeStore } from "@/stores/themeStore";
import { BUILT_IN_THEMES } from "@/themes/presets";

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

  test("les clés qui désarment un garde-fou portent la conséquence déclarée", () => {
    expect(settingDef("toggles.plugin-install-review")!.consequence!.key)
      .toBe("settings.mcp.consequence.pluginInstallReview");
    expect(settingDef("security.sessionTimeoutMinutes")!.consequence!.key)
      .toBe("settings.mcp.consequence.sessionTimeout");
    expect(settingDef("updater.autoUpdate")!.consequence!.key)
      .toBe("settings.mcp.consequence.autoUpdate");
  });

  test("aucune autre clé ne porte de conséquence", () => {
    const guarded = settingDefs().filter((d) => d.consequence).map((d) => d.key);
    expect(guarded.sort()).toEqual([
      "security.sessionTimeoutMinutes",
      "toggles.plugin-install-review",
      "updater.autoUpdate",
    ]);
  });

  test("une bascule de sûreté n'est affaiblie que lorsqu'on l'éteint", () => {
    for (const key of ["toggles.plugin-install-review", "updater.autoUpdate"]) {
      const c = settingDef(key)!.consequence!;
      expect(c.weakens(false, true)).toBe(true);
      expect(c.weakens(true, false)).toBe(false);
    }
  });

  test("le délai de verrouillage n'est affaibli que s'il s'allonge ou disparaît", () => {
    const c = settingDef("security.sessionTimeoutMinutes")!.consequence!;
    expect(c.weakens(null, 15)).toBe(true);
    expect(c.weakens(30, 15)).toBe(true);
    expect(c.weakens(5, 15)).toBe(false);
    expect(c.weakens(15, 15)).toBe(false);
    expect(c.weakens(30, null)).toBe(false);
  });

  test("chaque conséquence déclarée résout une phrase, pas une clé", () => {
    for (const c of Object.values(GUARDED)) {
      expect(i18n.t(c.key)).not.toBe(c.key);
      expect(i18n.t(c.key).startsWith("key '")).toBe(false);
    }
  });

  // La régression qui a motivé ce test : 40 des 56 entrées pointaient sur une
  // clé absente ou sur un NŒUD OBJET, et i18n.t() rendait alors un diagnostic
  // ("key 'x (en)' returned an object instead of string") servi comme libellé.
  test("chaque entrée porte un libellé traduit, jamais une clé ni un diagnostic", () => {
    for (const d of settingDefs()) {
      const label = i18n.t(d.labelKey);
      expect(label, d.key).not.toBe(d.labelKey);
      expect(label.startsWith("key '"), `${d.key} → ${d.labelKey}: ${label}`).toBe(false);
      expect(label.trim(), d.key).not.toBe("");
    }
  });

  test("toute catégorie déclarée par TOGGLE_DEFS est mappée sur une section", () => {
    const prefix = "settings.toggleDefs.category.";
    for (const def of Object.values(TOGGLE_DEFS)) {
      const category = def.descriptionKey.slice(prefix.length);
      expect(def.descriptionKey.startsWith(prefix), def.descriptionKey).toBe(true);
      expect(Object.keys(TOGGLE_SECTION)).toContain(category);
    }
  });

  test("les enums dynamiques sont calculés à l'appel, pas figés", () => {
    const before = settingDef("theme.activeThemeId")!.values!;
    const customThemes = useThemeStore.getState().customThemes;
    const probe = { ...BUILT_IN_THEMES[0], id: "custom-e2e-probe" };
    useThemeStore.setState({ customThemes: [...customThemes, probe] });
    try {
      const after = settingDef("theme.activeThemeId")!.values!;
      expect(before).not.toContain("custom-e2e-probe");
      expect(after).toContain("custom-e2e-probe");
    } finally {
      useThemeStore.setState({ customThemes });
    }
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
