// @vitest-environment jsdom
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { usePolicyStore } from "@/stores/policyStore";
import { useSyncPrefsStore, SYNC_SETTING_DOMAINS } from "./syncPrefsStore";
import { USER_DATA_HANDLERS } from "@/services/user-data/registry";

describe("settings domain toggles", () => {
  beforeEach(() => useSyncPrefsStore.setState({ syncSettingDomains: {} }));

  test("lists the five toggleable domains and not vaults", () => {
    expect(SYNC_SETTING_DOMAINS.map((d) => d.id)).toEqual([
      "themes", "uiPreferences", "shortcuts", "appSettings", "recentPeople",
    ]);
  });

  test("domains sync by default", () => {
    expect(useSyncPrefsStore.getState().isDomainSynced("themes")).toBe(true);
  });

  test("switching a domain off is remembered", () => {
    useSyncPrefsStore.getState().setSyncSettingDomain("themes", false);
    expect(useSyncPrefsStore.getState().isDomainSynced("themes")).toBe(false);
    expect(useSyncPrefsStore.getState().isDomainSynced("appSettings")).toBe(true);
  });

  test("vaults always syncs, even if a stale value says otherwise", () => {
    useSyncPrefsStore.setState({ syncSettingDomains: { vaults: false } });
    expect(useSyncPrefsStore.getState().isDomainSynced("vaults")).toBe(true);
  });

  test("every handler has a sync toggle, or is the vaults exception", () => {
    const handlerKeys = new Set(USER_DATA_HANDLERS.map((h) => h.key));
    const togglableKeys = new Set([...SYNC_SETTING_DOMAINS.map((d) => d.id), "vaults"]);
    expect(togglableKeys).toEqual(handlerKeys);
  });
});

describe("per-setting overrides", () => {
  beforeEach(() =>
    useSyncPrefsStore.setState({ syncSettingDomains: {}, settingSyncOverrides: {} }),
  );

  test("an ordinary key syncs by default", () => {
    expect(useSyncPrefsStore.getState().isSettingSynced("appSettings.keepalivePreset")).toBe(true);
  });

  test("the UI language stays on the device by default", () => {
    expect(useSyncPrefsStore.getState().isSettingSynced("appSettings.locale")).toBe(false);
  });

  test("a device-scoped key does not sync by default", () => {
    expect(useSyncPrefsStore.getState().isSettingSynced("appSettings.terminal.preferredShell")).toBe(false);
  });

  test("an explicit override beats the registry default in both directions", () => {
    const s = useSyncPrefsStore.getState();
    s.setSettingSync("appSettings.terminal.preferredShell", true);
    s.setSettingSync("appSettings.keepalivePreset", false);
    expect(useSyncPrefsStore.getState().isSettingSynced("appSettings.terminal.preferredShell")).toBe(true);
    expect(useSyncPrefsStore.getState().isSettingSynced("appSettings.keepalivePreset")).toBe(false);
  });

  test("a switched-off domain overrides an opted-in key", () => {
    const s = useSyncPrefsStore.getState();
    s.setSettingSync("appSettings.terminal.preferredShell", true);
    s.setSyncSettingDomain("appSettings", false);
    expect(useSyncPrefsStore.getState().isSettingSynced("appSettings.terminal.preferredShell")).toBe(false);
  });

  test("an unknown path syncs, so a stale override cannot hide a new setting", () => {
    expect(useSyncPrefsStore.getState().isSettingSynced("appSettings.somethingNew")).toBe(true);
  });

  test("a missing or undefined override map does not break the read path", () => {
    useSyncPrefsStore.setState({ settingSyncOverrides: undefined as unknown as Record<string, boolean> });
    expect(() => useSyncPrefsStore.getState().isSettingSynced("appSettings.keepalivePreset")).not.toThrow();
  });
});

describe("policy locks", () => {
  const lock = (policy: Record<string, unknown>) =>
    usePolicyStore.setState({ machine: { policy, defaults: {} }, server: { policy: {}, defaults: {} } });
  beforeEach(() => {
    useSyncPrefsStore.setState({ syncSettingDomains: {}, syncTypes: {}, settingSyncOverrides: {} });
    lock({});
  });
  afterEach(() => lock({}));

  test("a locked-off domain overrides the user's on", () => {
    lock({ "sync.domains.themes": false });
    expect(useSyncPrefsStore.getState().isDomainSynced("themes")).toBe(false);
  });

  test("a locked-on domain overrides the user's off", () => {
    useSyncPrefsStore.setState({ syncSettingDomains: { themes: false } });
    lock({ "sync.domains.themes": true });
    expect(useSyncPrefsStore.getState().isDomainSynced("themes")).toBe(true);
  });

  test("a locked-off type stops object sync", () => {
    lock({ "sync.types.hosts": false });
    expect(useSyncPrefsStore.getState().isTypeSynced("hosts")).toBe(false);
    expect(useSyncPrefsStore.getState().isObjectSynced("x", "hosts")).toBe(false);
  });

  test("setters are ignored for locked keys", () => {
    lock({ "sync.domains.themes": false, "sync.types.hosts": false, "sync.settings.appSettings.locale": false });
    const s = useSyncPrefsStore.getState();
    s.setSyncSettingDomain("themes", true);
    s.setSyncType("hosts", true);
    s.setSettingSync("appSettings.locale", true);
    expect(useSyncPrefsStore.getState().syncSettingDomains).toEqual({});
    expect(useSyncPrefsStore.getState().syncTypes).toEqual({});
    expect(useSyncPrefsStore.getState().settingSyncOverrides).toEqual({});
  });

  test("a locked per-setting value wins, but a locked-off domain still forces false", () => {
    lock({ "sync.settings.appSettings.locale": true });
    expect(useSyncPrefsStore.getState().isSettingSynced("appSettings.locale")).toBe(true);
    lock({ "sync.settings.appSettings.locale": true, "sync.domains.appSettings": false });
    expect(useSyncPrefsStore.getState().isSettingSynced("appSettings.locale")).toBe(false);
  });
});
