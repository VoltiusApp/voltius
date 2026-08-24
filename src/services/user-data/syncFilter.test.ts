import { describe, test, expect, beforeEach, vi } from "vitest";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { filterOutgoing, filterIncoming, restoreLocal, heldBackKeys } from "./syncFilter";
import { useTerminalSettingsStore } from "@/stores/terminalSettingsStore";
import { useThemeStore } from "@/stores/themeStore";
import { useToggleSettingsStore } from "@/stores/toggleSettingsStore";
import { appSettingsHandler } from "./handlers/appSettings";
import type { UserDataBundle } from "./formats";

const bundle = (): UserDataBundle => ({
  type: "voltius-user-data",
  version: 2,
  exported_at: "2026-08-20T00:00:00.000Z",
  sections: {
    themes: { data: { activeThemeId: "dracula" }, updated_at: "2026-08-20T00:00:00.000Z" },
    appSettings: { data: { locale: "fr" }, updated_at: "2026-08-20T00:00:00.000Z" },
    vaults: { data: {}, updated_at: "2026-08-20T00:00:00.000Z" },
  },
});

describe("syncFilter", () => {
  beforeEach(() => useSyncPrefsStore.setState({ syncSettingDomains: {} }));

  test("passes everything through when nothing is switched off", () => {
    expect(Object.keys(filterOutgoing(bundle()).sections).sort())
      .toEqual(["appSettings", "themes", "vaults"]);
  });

  test("drops a switched-off section on the way out", () => {
    useSyncPrefsStore.getState().setSyncSettingDomain("themes", false);
    const out = filterOutgoing(bundle());
    expect(out.sections.themes).toBeUndefined();
    expect(out.sections.appSettings).toBeDefined();
  });

  test("drops a switched-off section on the way in", () => {
    useSyncPrefsStore.getState().setSyncSettingDomain("themes", false);
    expect(filterIncoming(bundle()).sections.themes).toBeUndefined();
  });

  test("never drops vaults", () => {
    useSyncPrefsStore.setState({ syncSettingDomains: { vaults: false } });
    expect(filterOutgoing(bundle()).sections.vaults).toBeDefined();
  });

  test("does not mutate the input", () => {
    useSyncPrefsStore.getState().setSyncSettingDomain("themes", false);
    const input = bundle();
    filterOutgoing(input);
    expect(input.sections.themes).toBeDefined();
  });
});

const appBundle = (): UserDataBundle => ({
  type: "voltius-user-data",
  version: 2,
  exported_at: "2026-08-22T00:00:00.000Z",
  sections: {
    appSettings: {
      data: {
        terminal: { preferredShell: "/bin/zsh", cursorStyle: "bar" },
        toggles: { "cursor-blink": false },
        locale: "fr",
      },
      updated_at: "2026-08-22T00:00:00.000Z",
    },
  },
});

describe("per-key filtering", () => {
  beforeEach(() =>
    useSyncPrefsStore.setState({ syncSettingDomains: {}, settingSyncOverrides: {} }),
  );

  test("deletes a device-scoped key on the way out, by default", () => {
    const out = filterOutgoing(appBundle());
    const data = out.sections.appSettings.data as Record<string, Record<string, unknown>>;
    expect("preferredShell" in data.terminal).toBe(false);
    expect(data.terminal.cursorStyle).toBe("bar");
  });

  test("deletes a key the user switched off, and keeps its siblings", () => {
    useSyncPrefsStore.getState().setSettingSync("appSettings.locale", false);
    const data = filterOutgoing(appBundle()).sections.appSettings.data as Record<string, unknown>;
    expect("locale" in data).toBe(false);
    expect(data.toggles).toEqual({ "cursor-blink": false });
  });

  test("keeps an opted-in device-scoped key", () => {
    useSyncPrefsStore.getState().setSettingSync("appSettings.terminal.preferredShell", true);
    const data = filterOutgoing(appBundle()).sections.appSettings.data as Record<string, Record<string, unknown>>;
    expect(data.terminal.preferredShell).toBe("/bin/zsh");
  });

  test("does not mutate the caller's section data", () => {
    const input = appBundle();
    filterOutgoing(input);
    const data = input.sections.appSettings.data as Record<string, Record<string, unknown>>;
    expect(data.terminal.preferredShell).toBe("/bin/zsh");
  });

  test("leaves the incoming bundle's keys alone", () => {
    const data = filterIncoming(appBundle()).sections.appSettings.data as Record<string, Record<string, unknown>>;
    expect(data.terminal.preferredShell).toBe("/bin/zsh");
  });

  test("takes no copy when nothing is held back", () => {
    useSyncPrefsStore.getState().setSettingSync("appSettings.terminal.preferredShell", true);
    const input = appBundle();
    expect(filterOutgoing(input).sections.appSettings).toBe(input.sections.appSettings);
  });

  test("strips several held-back keys at once, leaving siblings and untouched domains alone", () => {
    useSyncPrefsStore.getState().setSettingSync("appSettings.locale", false);
    const input: UserDataBundle = {
      ...appBundle(),
      sections: {
        ...appBundle().sections,
        themes: { data: { activeThemeId: "dracula" }, updated_at: "2026-08-22T00:00:00.000Z" },
      },
    };
    const out = filterOutgoing(input);
    const appData = out.sections.appSettings.data as Record<string, Record<string, unknown>>;
    expect("preferredShell" in appData.terminal).toBe(false);
    expect("locale" in appData).toBe(false);
    expect(appData.terminal.cursorStyle).toBe("bar");
    expect(appData.toggles).toEqual({ "cursor-blink": false });
    // Copied, not shared: themes carries a held-back key of its own now.
    expect(out.sections.themes.data).toEqual({ activeThemeId: "dracula" });
  });

  test("holds back the theme location by default, keeping its siblings", () => {
    const data = filterOutgoing(themeBundle()).sections.themes.data as Record<string, unknown>;
    expect("location" in data).toBe(false);
    expect(data.mode).toBe("sunset");
  });

  test("keeps the theme location once the user opts in", () => {
    useSyncPrefsStore.getState().setSettingSync("themes.location", true);
    const data = filterOutgoing(themeBundle()).sections.themes.data as Record<string, unknown>;
    expect(data.location).toEqual(PARIS);
  });
});

const PARIS = { lat: 48.85, lng: 2.35, label: "Paris", source: "manual" } as const;
const TOKYO = { lat: 35.68, lng: 139.69, label: "Tokyo", source: "manual" } as const;

const themeBundle = (): UserDataBundle => ({
  type: "voltius-user-data",
  version: 2,
  exported_at: "2026-08-23T00:00:00.000Z",
  sections: {
    themes: {
      data: { activeThemeId: "dracula", mode: "sunset", location: PARIS },
      updated_at: "2026-08-23T00:00:00.000Z",
    },
  },
});

describe("restoreLocal", () => {
  beforeEach(() => {
    useSyncPrefsStore.setState({ syncSettingDomains: {}, settingSyncOverrides: {} });
    useTerminalSettingsStore.setState({ preferredShell: "/usr/bin/fish" });
    useToggleSettingsStore.setState({ values: {} });
  });

  test("re-injects this device's value over a remote one that won the merge", () => {
    const remoteWon = appBundle();
    const out = restoreLocal(remoteWon);
    const data = out.sections.appSettings.data as Record<string, Record<string, unknown>>;
    expect(data.terminal.preferredShell).toBe("/usr/bin/fish");
    // Synced siblings still take the remote value.
    expect(data.terminal.cursorStyle).toBe("bar");
  });

  test("deletes a held-back key this device has no value for", () => {
    useSyncPrefsStore.getState().setSettingSync("appSettings.toggles.cursor-blink", false);
    const data = restoreLocal(appBundle()).sections.appSettings.data as Record<string, Record<string, unknown>>;
    expect("cursor-blink" in data.toggles).toBe(false);
  });

  test("does not mutate the bundle it was given", () => {
    const input = appBundle();
    restoreLocal(input);
    const data = input.sections.appSettings.data as Record<string, Record<string, unknown>>;
    expect(data.terminal.preferredShell).toBe("/bin/zsh");
  });

  test("ignores a domain the bundle does not carry", () => {
    expect(() => restoreLocal({ ...appBundle(), sections: {} })).not.toThrow();
  });

  test("re-injects this device's coordinates over a remote theme location", () => {
    useThemeStore.setState({ location: PARIS });
    const remote = themeBundle();
    (remote.sections.themes.data as Record<string, unknown>).location = TOKYO;
    const data = restoreLocal(remote).sections.themes.data as Record<string, unknown>;
    expect(data.location).toEqual(PARIS);
    expect(data.mode).toBe("sunset");
  });

  test("reads this device's export once per domain, however many of its keys are held back", () => {
    useSyncPrefsStore.getState().setSettingSync("appSettings.toggles.cursor-blink", false);
    const spy = vi.spyOn(appSettingsHandler, "export");
    restoreLocal(appBundle());
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe("heldBackKeys", () => {
  beforeEach(() =>
    useSyncPrefsStore.setState({ syncSettingDomains: {}, settingSyncOverrides: {} }),
  );

  test("lists the device-scoped default", () => {
    expect(heldBackKeys("appSettings").map((k) => k.id)).toEqual([
      "appSettings.terminal.preferredShell",
    ]);
  });

  test("lists a user choice too", () => {
    useSyncPrefsStore.getState().setSettingSync("appSettings.locale", false);
    expect(heldBackKeys("appSettings").map((k) => k.id)).toContain("appSettings.locale");
  });

  test("is empty for a domain whose sync is off — the domain toggle is the whole story", () => {
    useSyncPrefsStore.getState().setSyncSettingDomain("appSettings", false);
    expect(heldBackKeys("appSettings")).toEqual([]);
  });

  test("lists the theme location, so the Sync panel can say so", () => {
    expect(heldBackKeys("themes").map((k) => k.id)).toEqual(["themes.location"]);
  });
});
