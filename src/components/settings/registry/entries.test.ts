// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import i18n from "@/i18n";
import { GUARDED, settingDef, settingDefs } from "./entries";
import { TOGGLE_DEFS } from "@/stores/toggleSettingsStore";
import { SYNC_OBJECT_TYPES } from "@/stores/syncPrefsStore";
import { useThemeStore } from "@/stores/themeStore";
import { useConnectivitySettingsStore, DEFAULT_DETACHED_TTL_HOURS } from "@/stores/connectivitySettingsStore";
import { useTerminalSettingsStore } from "@/stores/terminalSettingsStore";
import { DEFAULT_KEYWORD_RULES } from "@/utils/keywordMatcher";
import { BUILT_IN_THEMES } from "@/themes/presets";
import { isSettingsSection } from "@/stores/uiStore";
import { useLocaleStore } from "@/stores/localeStore";
import { usePolicyStore } from "@/stores/policyStore";
import { settingKey } from "@/services/user-data/settingKeys";
import { effectiveDefault, isDirtyValue, resetSetting } from "./defaults";
import { renderHook } from "@testing-library/react";
import { useToggleSettingsStore } from "@/stores/toggleSettingsStore";
import { SYNC_SETTING_DOMAINS } from "@/stores/syncDomains";
import { useSettingState } from "./useSettingState";

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
      "security.lockAction",
      "security.sessionTimeoutMinutes",
      "security.systemAuthUnlock",
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

  test("passer de « Immédiatement » à un délai affaiblit le verrouillage", () => {
    const c = settingDef("security.sessionTimeoutMinutes")!.consequence!;
    expect(c.weakens(5, 0)).toBe(true);
    expect(c.weakens(0, 5)).toBe(false);
    expect(settingDef("security.sessionTimeoutMinutes")!.min).toBe(0);
  });

  test("un verrouillage qui garde la clé en mémoire affaiblit le verrouillage", () => {
    const c = settingDef("security.lockAction")!.consequence!;
    expect(c.key).toBe("settings.mcp.consequence.lockAction");
    expect(c.weakens("screen", "vault")).toBe(true);
    expect(c.weakens("vault", "screen")).toBe(false);
  });

  test("activer le déverrouillage système affaiblit le verrouillage", () => {
    const c = settingDef("security.systemAuthUnlock")!.consequence!;
    expect(c.key).toBe("settings.mcp.consequence.systemAuthUnlock");
    expect(c.weakens(true, false)).toBe(true);
    expect(c.weakens(false, true)).toBe(false);
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

  test("detachedTtlHours expose les durées proposées et relit le magasin", () => {
    const def = settingDef("connectivity.detachedTtlHours")!;
    expect(def.values).toEqual(["1", "6", "12", "24", "72", "168"]);
    def.set!("72");
    expect(useConnectivitySettingsStore.getState().detachedTtlHours).toBe(72);
    expect(def.get()).toBe("72");
    def.set!(DEFAULT_DETACHED_TTL_HOURS);
  });

  test("chaque entrée nomme une section réelle de l'écran Settings", () => {
    const sections = new Set([
      "appearance", "account", "sync", "vaults", "plugins", "integrations",
      "terminal", "sftp", "portForwarding", "hosts", "shortcuts", "diagnostics", "about",
    ]);
    for (const d of settingDefs()) expect(sections.has(d.section)).toBe(true);
  });
});

describe("settings registry", () => {
  afterEach(() => usePolicyStore.setState({ machine: { policy: {}, defaults: {} } }));

  test("every entry has a control, a valid section and an en label", () => {
    for (const d of settingDefs()) {
      expect(d.control, d.key).toBeDefined();
      expect(typeof d.use, d.key).toBe("function");
      expect(isSettingsSection(d.section), d.key).toBe(true);
      expect(i18n.exists(d.labelKey, { lng: "en" }), d.key).toBe(true);
      if (d.descKey) expect(i18n.exists(d.descKey, { lng: "en" }), `${d.key} → ${d.descKey}`).toBe(true);
    }
  });

  test("settingDefs is memoized", () => {
    expect(settingDefs()).toBe(settingDefs());
  });

  test("locale default is the store's initial value", () => {
    expect(settingDef("locale.language")!.default).toBe(useLocaleStore.getInitialState().locale);
  });

  test("reset clears dirty", () => {
    for (const d of settingDefs()) {
      if (!d.writable || !d.set || d.control.kind === "open" || d.resettable === false) continue;
      const other = d.type === "boolean" ? !effectiveDefault(d)
        : d.values?.find((v) => v !== String(effectiveDefault(d)))
          ?? (typeof effectiveDefault(d) === "number" ? (d.min ?? 0) + 1 : undefined);
      if (other === undefined) continue;
      d.set(other);
      expect(isDirtyValue(d, d.get()), d.key).toBe(true);
      resetSetting(d);
      expect(isDirtyValue(d, d.get()), d.key).toBe(false);
    }
  });

  test("admin default counts as default", () => {
    usePolicyStore.setState({ machine: { policy: {}, defaults: { "appSettings.keepalivePreset": "tolerant" } } });
    const d = settingDef("connectivity.keepalivePreset")!;
    d.set!("tolerant");
    expect(effectiveDefault(d)).toBe("tolerant");
    expect(isDirtyValue(d, d.get())).toBe(false);
    d.set!("fast");
    expect(isDirtyValue(d, d.get())).toBe(true);
    resetSetting(d);
    expect(d.get()).toBe("tolerant");
    usePolicyStore.setState({ machine: { policy: {}, defaults: {} } });
    d.set!(effectiveDefault(d));
  });

  test("syncKey exists in SETTING_KEYS", () => {
    for (const d of settingDefs()) {
      if (d.syncKey) expect(settingKey(d.syncKey), `${d.key} → ${d.syncKey}`).toBeDefined();
    }
  });
});

describe("registry coverage", () => {
  const NEW_KEYS = [
    "appearance.uiScale", "appearance.terminalFontSize",
    "theme.scheduleLightStart", "theme.scheduleDarkStart", "themes.location",
    "hosts.pollIntervalMs", "hosts.activePollIntervalMs", "connectivity.proxy",
    ...SYNC_SETTING_DOMAINS.map((d) => `sync.domain.${d.id}`),
  ];

  test("registers every value row in the inventory", () => {
    for (const k of NEW_KEYS) expect(settingDef(k), k).toBeDefined();
  });

  test("dependent entries report inactive when their parent is off", () => {
    useToggleSettingsStore.getState().set("reachability", false);
    try {
      const { result } = renderHook(() => useSettingState("hosts.pollIntervalMs"));
      expect(result.current.active).toBe(false);
    } finally {
      useToggleSettingsStore.getState().set("reachability", true);
    }
  });

  test("terminal font size override is dirty only when set", () => {
    const d = settingDef("appearance.terminalFontSize")!;
    expect(isDirtyValue(d, null)).toBe(false);
    expect(isDirtyValue(d, 16)).toBe(true);
  });

  test("system unlock cannot be reset from a list", () => {
    expect(settingDef("security.systemAuthUnlock")!.resettable).toBe(false);
  });
});

describe("team defaults on compound and string entries", () => {
  const team = (defaults: Record<string, unknown>) =>
    usePolicyStore.setState({ machine: { policy: {}, defaults } });
  afterEach(() => team({}));

  test("detached TTL: a numeric team default is not a change", () => {
    team({ "appSettings.detachedTtlHours": 72 });
    const d = settingDef("connectivity.detachedTtlHours")!;
    d.set!("72");
    expect(isDirtyValue(d, d.get())).toBe(false);
    d.set!("6");
    resetSetting(d);
    expect(d.get()).toBe("72");
    expect(isDirtyValue(d, d.get())).toBe(false);
    team({});
    resetSetting(d);
  });

  test("proxy resets to the team default", () => {
    team({ "appSettings.proxy": { mode: "system" } });
    const d = settingDef("connectivity.proxy")!;
    useConnectivitySettingsStore.getState().setProxy({ mode: "none" });
    expect(isDirtyValue(d, d.get())).toBe(true);
    resetSetting(d);
    expect(useConnectivitySettingsStore.getState().proxy.mode).toBe("system");
    expect(isDirtyValue(d, d.get())).toBe(false);
    team({});
    resetSetting(d);
  });

  test("preferred shell and location applied by the team are not changes", () => {
    const spot = { lat: 1, lng: 2, label: "x", source: "manual" as const };
    team({ "appSettings.terminal.preferredShell": "/bin/zsh", "themes.location": spot });
    const shell = settingDef("terminal.preferredShell")!;
    shell.set!("/bin/zsh");
    expect(isDirtyValue(shell, shell.get())).toBe(false);
    const loc = settingDef("themes.location")!;
    useThemeStore.getState().setLocation(spot);
    expect(isDirtyValue(loc, loc.get())).toBe(false);
    team({});
    resetSetting(shell);
    resetSetting(loc);
  });

  test("keyword highlight resets to the team's rules", () => {
    const rules = [{ ...DEFAULT_KEYWORD_RULES[0], words: ["boom"] }];
    team({ "appSettings.terminal.keywordRules": rules });
    const d = settingDef("toggles.keyword-highlight")!;
    useTerminalSettingsStore.getState().setKeywordRules([]);
    expect(isDirtyValue(d, d.get())).toBe(true);
    resetSetting(d);
    expect(useTerminalSettingsStore.getState().keywordRules[0]?.words).toEqual(["boom"]);
    expect(isDirtyValue(d, d.get())).toBe(false);
    team({});
    resetSetting(d);
  });
});
