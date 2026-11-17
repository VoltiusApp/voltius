import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginManifest } from "@/plugins/api";
import type { InstalledPluginMeta, MarketplacePlugin } from "@/stores/marketplaceStore";
import type { SeededEntry } from "@/stores/seededTombstoneStore";
import type { SyncedPlugin, SyncedPluginFields } from "@/stores/syncedPluginStore";

type Result = { ok: true; result: object } | { ok: false; error: string };

const h = vi.hoisted(() => ({
  GREW: "permissions grew",
  policy: [] as string[],
  blocked: new Set<string>(),
  locks: {} as Record<string, unknown>,
  recordInstall: vi.fn(async (_id: string, _fields: SyncedPluginFields, _opts?: { force?: boolean }) => {}),
  recordUninstall: vi.fn(async () => {}),
  seed: vi.fn(async (_items: Array<{ id: string } & SyncedPluginFields>) => {}),
  entries: [] as SyncedPlugin[],
  excluded: new Set<string>(),
  toggleExcluded: vi.fn(),
  loaded: [] as PluginManifest[],
  seeded: new Map<string, SeededEntry>(),
  removed: [] as string[],
  loginSettled: vi.fn(async () => {}),
  appToast: vi.fn(),
  manifests: {} as Record<string, { deviceName?: string }>,
  known: {} as Record<string, { name?: string }>,
  typeSynced: true,
  market: {
    installing: new Set<string>(),
    installedMeta: [] as InstalledPluginMeta[],
    catalog: [] as MarketplacePlugin[],
    appVersion: null as string | null,
    fetchCatalog: vi.fn(async () => {}),
    loadAppVersion: vi.fn(async () => {}),
  },
  installWithConsent: vi.fn(
    async (_target: string | MarketplacePlugin, _consented: string[], _opts?: { syncDriven?: boolean }): Promise<Result> =>
      ({ ok: true, result: {} }),
  ),
  uninstallPlugin: vi.fn(async (id: string): Promise<Result> => ({ ok: true, result: { id } })),
}));
vi.mock("@/stores/pluginRegistryStore", () => ({
  policyInstallList: () => h.policy,
  installAllowed: (id: string) => !h.blocked.has(id),
}));
vi.mock("@/stores/syncedPluginStore", () => ({
  useSyncedPluginStore: {
    getState: () => ({ entries: h.entries, seed: h.seed, recordInstall: h.recordInstall, recordUninstall: h.recordUninstall }),
  },
}));
vi.mock("@/stores/syncPrefsStore", () => ({
  useSyncPrefsStore: {
    getState: () => ({
      isExcluded: (id: string) => h.excluded.has(id),
      toggleExcluded: h.toggleExcluded,
      isTypeSynced: () => h.typeSynced,
      isObjectSynced: (id: string) => h.typeSynced && !h.excluded.has(id),
    }),
  },
}));
vi.mock("@/plugins/runtime", () => ({ getLoadedPlugins: () => h.loaded }));
vi.mock("@/stores/marketplaceStore", () => ({
  FIRST_PARTY_SOURCE: { id: "voltius" },
  useMarketplaceStore: { getState: () => h.market },
}));
vi.mock("@/stores/seededTombstoneStore", () => ({
  loadSeededEntries: async () => h.seeded,
  useSeededTombstoneStore: { getState: () => ({ removed: h.removed }) },
}));
vi.mock("@/i18n", () => ({
  default: { t: (key: string, o?: Record<string, unknown>) => `${key}|${JSON.stringify(o ?? {})}` },
}));
vi.mock("@/services/appToast", () => ({ appToast: h.appToast }));
vi.mock("@/stores/crossDeviceSessionsStore", () => ({
  useCrossDeviceSessionsStore: { getState: () => ({ manifests: h.manifests }) },
}));
vi.mock("@/stores/lanSyncStore", () => ({ useLanSyncStore: { getState: () => ({ known: h.known }) } }));
vi.mock("@/services/loginSyncGate", () => ({ whenLoginSyncSettled: h.loginSettled }));
vi.mock("@/services/cliPlugins", () => ({ PERMISSIONS_GREW: h.GREW, installWithConsent: h.installWithConsent }));
vi.mock("@/plugins/domains/plugins", () => ({ uninstallPlugin: h.uninstallPlugin }));
vi.mock("@/stores/policyStore", () => ({ lockedBool: (key: string) => h.locks[key] }));
vi.mock("@/stores/toggleSettingsStore", () => ({ toggleKey: (id: string) => `appSettings.toggles.${id}` }));

import {
  consentStillWanted,
  installedSourceId,
  keepOffThisDevice,
  keepOnThisDevice,
  notifySyncedChanges,
  pluginSyncBlockedReason,
  reconcileSyncedPlugins,
  resolveSyncedCandidate,
  recordUserInstall,
  recordUserUninstall,
  syncEligible,
  useSyncedPluginConsentStore,
} from "./pluginSync";

const entry = (over: Partial<MarketplacePlugin> = {}): MarketplacePlugin => ({
  id: "p1", name: "P1", author: "a", description: "d", repo: "o/p1", version: "1.0.0",
  tags: [], theme: false, sourceId: "voltius", hash: "h", cssHash: "c", ...over,
});
const manifest = { id: "p1", name: "Plugin One", version: "1.0.0", permissions: ["net"] } as PluginManifest;

beforeEach(() => {
  vi.resetAllMocks();
  h.policy = [];
  h.excluded = new Set();
  h.blocked = new Set();
  h.locks = {};
  h.entries = [];
  h.loaded = [];
  h.seeded = new Map();
  h.removed = [];
  h.manifests = {};
  h.known = {};
  h.typeSynced = true;
  h.toggleExcluded.mockImplementation((id: string) => {
    if (!h.excluded.delete(id)) h.excluded.add(id);
  });
  h.market.installing = new Set();
  h.market.installedMeta = [];
  h.market.catalog = [];
  h.market.appVersion = null;
  useSyncedPluginConsentStore.setState({ queue: [] });
});

describe("pluginSync", () => {
  it("records an eligible install with entry and manifest fields", async () => {
    await recordUserInstall(entry(), manifest);

    expect(h.recordInstall).toHaveBeenCalledWith(
      "p1",
      { repo: "o/p1", source_id: "voltius", hash: "h", css_hash: "c", permissions: ["net"], name: "Plugin One" },
      { force: false },
    );
  });

  it("uses null hashes and empty permissions when absent", async () => {
    await recordUserInstall(entry({ hash: undefined, cssHash: undefined }), { id: "p1", name: "P1", version: "1" } as PluginManifest);

    expect(h.recordInstall).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ hash: null, css_hash: null, permissions: [] }),
      { force: false },
    );
  });

  it("policy-listed and local-source installs record nothing", async () => {
    h.policy = ["p1"];
    await recordUserInstall(entry(), manifest);
    h.policy = [];
    await recordUserInstall(entry({ sourceId: "local" }), manifest);
    await recordUserInstall(entry({ sourceId: "url" }), manifest);

    expect(h.recordInstall).not.toHaveBeenCalled();
    expect(syncEligible("p1", "voltius")).toBe(true);
  });

  describe("pluginSyncBlockedReason", () => {
    const key = (k: string) => `settings.plugins.sync.blocked.${k}`;
    const ON = { configured: true, paused: false };
    const OFF = { configured: false, paused: false };

    it("local and url sources are blocked as localSource", () => {
      expect(pluginSyncBlockedReason("p1", "local", ON)).toBe(key("localSource"));
      expect(pluginSyncBlockedReason("p1", "url", ON)).toBe(key("localSource"));
    });

    it("policy-listed ids are blocked as managed", () => {
      h.policy = ["p1"];
      expect(pluginSyncBlockedReason("p1", "voltius", ON)).toBe(key("managed"));
    });

    it("a turned-off plugin sync type is blocked as typeOff", () => {
      h.typeSynced = false;
      expect(pluginSyncBlockedReason("p1", "voltius", ON)).toBe(key("typeOff"));
    });

    it("no active provider and no LAN group is blocked as noChannel", () => {
      expect(pluginSyncBlockedReason("p1", "voltius", OFF)).toBe(key("noChannel"));
    });

    it("any active sync provider is enough", () => {
      expect(pluginSyncBlockedReason("p1", "voltius", ON)).toBeNull();
    });

    it("paused Voltius sync still counts as a channel", () => {
      expect(pluginSyncBlockedReason("p1", "voltius", { configured: false, paused: true })).toBeNull();
    });

    it("a LAN group is enough without an account", () => {
      h.known = { d1: {} };
      expect(pluginSyncBlockedReason("p1", "voltius", OFF)).toBeNull();
    });
  });

  it("user install of an excluded id clears the exclusion first, then forces a fresh entry", async () => {
    h.excluded.add("p1");
    const excludedWhenRecorded: boolean[] = [];
    h.recordInstall.mockImplementation(async () => {
      excludedWhenRecorded.push(h.excluded.has("p1"));
    });
    await recordUserInstall(entry(), manifest);

    expect(h.toggleExcluded).toHaveBeenCalledWith("p1");
    expect(excludedWhenRecorded).toEqual([false]);
    expect(h.recordInstall).toHaveBeenCalledWith("p1", expect.anything(), { force: true });
  });

  it("leaves a non-excluded id's preference alone", async () => {
    await recordUserInstall(entry(), manifest);

    expect(h.toggleExcluded).not.toHaveBeenCalled();
  });

  it("a failing record is swallowed and restores the exclusion", async () => {
    h.excluded.add("p1");
    h.recordInstall.mockRejectedValueOnce(new Error("corrupt"));
    h.recordUninstall.mockRejectedValueOnce(new Error("corrupt"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(recordUserInstall(entry(), manifest)).resolves.toBeUndefined();
    await expect(recordUserUninstall("p1")).resolves.toBeUndefined();

    expect(h.excluded.has("p1")).toBe(true);
  });

  it("uninstall delegates to recordUninstall", async () => {
    await recordUserUninstall("p1");

    expect(h.recordUninstall).toHaveBeenCalledWith("p1");
  });
});

const synced = (id: string, over: Partial<SyncedPlugin> = {}): SyncedPlugin => ({
  id, repo: `o/${id}`, source_id: "voltius", hash: `h-${id}`, css_hash: null, permissions: ["net"], name: id,
  device_id: "dev-b", installed_at: "2026-11-17T00:00:00Z", updated_at: "2026-11-17T00:00:00Z", clocks: {}, ...over,
});
const tombstone = (id: string) => synced(id, { deleted_at: "2026-11-17T01:00:00Z" });
const loadedManifest = (id: string, permissions: string[] = ["net"]) =>
  ({ id, name: `Name ${id}`, version: "1.0.0", permissions }) as PluginManifest;
const meta = (id: string, over: Partial<InstalledPluginMeta> = {}): InstalledPluginMeta => ({
  id, version: "1.0.0", sourceId: "voltius", hash: `h-${id}`, cssHash: null, repo: `o/${id}`, ...over,
});
const seededEntry = (id: string): SeededEntry => ({ folder: id, manifest: loadedManifest(id) });
const seededIds = () => h.seed.mock.calls.flatMap(([items]) => items.map((i) => i.id));
const queued = () => useSyncedPluginConsentStore.getState().queue.map((r) => r.id);
const REVIEW_KEY = "appSettings.toggles.plugin-install-review";

const reconcileAfterBoot = () => reconcileSyncedPlugins({ boot: true });
const target = (over: Partial<MarketplacePlugin>) => expect.objectContaining(over);
const SYNC = { syncDriven: true };

describe("reconcileSyncedPlugins", () => {
  it("installedSourceId reads the meta, then a seeded artifact, else local", () => {
    h.market.installedMeta = [meta("ext", { sourceId: "custom" })];
    h.seeded = new Map([["b1", seededEntry("b1")]]);

    expect(installedSourceId("ext", h.seeded)).toBe("custom");
    expect(installedSourceId("b1", h.seeded)).toBe("voltius");
    expect(installedSourceId("dev", h.seeded)).toBe("local");
  });

  it("a merge before plugins have booted reconciles nothing", async () => {
    vi.resetModules();
    const fresh = await import("./pluginSync");
    h.entries = [synced("p2"), tombstone("p1")];
    h.loaded = [loadedManifest("p1"), loadedManifest("p3")];
    h.market.installedMeta = [meta("p1"), meta("p3")];
    h.market.catalog = [entry({ id: "p2" })];

    await fresh.reconcileSyncedPlugins();

    expect(h.installWithConsent).not.toHaveBeenCalled();
    expect(h.uninstallPlugin).not.toHaveBeenCalled();
    expect(h.seed).not.toHaveBeenCalled();

    await fresh.reconcileSyncedPlugins({ boot: true });
    await fresh.reconcileSyncedPlugins();

    expect(h.installWithConsent).toHaveBeenCalledTimes(2);
  });

  it("installs live entries missing here", async () => {
    h.entries = [synced("p2")];
    h.market.catalog = [entry({ id: "p2" })];

    await reconcileAfterBoot();

    expect(h.installWithConsent).toHaveBeenCalledWith(target({ id: "p2", sourceId: "voltius" }), ["net"], SYNC);
    expect(h.uninstallPlugin).not.toHaveBeenCalled();
  });

  it("waits for the login sync before reading the synced file", async () => {
    let settle = () => {};
    h.loginSettled.mockReturnValueOnce(new Promise<void>((r) => (settle = r)));
    h.market.catalog = [entry({ id: "p2" })];

    const run = reconcileAfterBoot();
    h.entries = [synced("p2")];
    await Promise.resolve();
    expect(h.installWithConsent).not.toHaveBeenCalled();
    settle();
    await run;

    expect(h.installWithConsent).toHaveBeenCalledWith(target({ id: "p2" }), ["net"], SYNC);
  });

  it("a merge during a run reconciles once more afterwards", async () => {
    let finish = (_: Result) => {};
    h.installWithConsent.mockReturnValueOnce(new Promise<Result>((r) => (finish = r)));
    h.entries = [synced("p2")];
    h.market.catalog = [entry({ id: "p2" })];

    const run = reconcileAfterBoot();
    await vi.waitFor(() => expect(h.installWithConsent).toHaveBeenCalledTimes(1));
    void reconcileSyncedPlugins();
    void reconcileSyncedPlugins();
    finish({ ok: false, error: "offline" });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await run;

    expect(h.installWithConsent).toHaveBeenCalledTimes(2);
  });

  it("fetches the catalogue before deciding when none is loaded", async () => {
    h.entries = [synced("p2")];
    h.market.fetchCatalog.mockImplementationOnce(async () => {
      h.market.catalog = [entry({ id: "p2" })];
    });

    await reconcileAfterBoot();

    expect(h.market.fetchCatalog).toHaveBeenCalledTimes(1);
    expect(h.installWithConsent).toHaveBeenCalledWith(target({ id: "p2" }), ["net"], SYNC);
  });

  it("prefers the entry's own source, then its recorded repo and hash, then another source", async () => {
    h.entries = [
      synced("p2", { source_id: "custom" }),
      synced("p4", { source_id: "gone" }),
      synced("p6", { source_id: "gone", hash: null }),
    ];
    h.market.catalog = [
      entry({ id: "p2", sourceId: "voltius" }),
      entry({ id: "p2", sourceId: "custom" }),
      entry({ id: "p4", sourceId: "voltius", repo: "other/p4", hash: "h-other" }),
      entry({ id: "p6", sourceId: "voltius" }),
    ];

    await reconcileAfterBoot();

    expect(h.installWithConsent).toHaveBeenCalledWith(target({ id: "p2", sourceId: "custom" }), ["net"], SYNC);
    expect(h.installWithConsent).toHaveBeenCalledWith(
      target({ id: "p4", sourceId: "gone", repo: "o/p4", hash: "h-p4" }),
      ["net"],
      SYNC,
    );
    expect(h.installWithConsent).toHaveBeenCalledWith(target({ id: "p6", sourceId: "voltius" }), ["net"], SYNC);
  });

  it("installs an entry its catalogue lacks from the recorded repo and hash", async () => {
    h.entries = [synced("p3", { source_id: "custom", css_hash: "c-p3" })];
    h.market.catalog = [entry({ id: "other" })];

    await reconcileAfterBoot();

    expect(h.installWithConsent).toHaveBeenCalledWith(
      target({ id: "p3", repo: "o/p3", sourceId: "custom", hash: "h-p3", cssHash: "c-p3", version: "" }),
      ["net"],
      SYNC,
    );
  });

  it("restores a removed built-in through the seeded floor unless the catalogue is newer", async () => {
    h.entries = [synced("b1", { repo: "", hash: null }), synced("b2"), synced("b3")];
    h.seeded = new Map([["b1", seededEntry("b1")], ["b2", seededEntry("b2")], ["b3", seededEntry("b3")]]);
    h.removed = ["b1", "b2", "b3"];
    h.market.catalog = [entry({ id: "b2", version: "1.0.0" }), entry({ id: "b3", version: "2.0.0" })];

    await reconcileAfterBoot();

    expect(h.market.loadAppVersion).toHaveBeenCalled();
    expect(h.installWithConsent).toHaveBeenCalledWith(target({ id: "b1", builtin: true }), ["net"], SYNC);
    expect(h.installWithConsent).toHaveBeenCalledWith(target({ id: "b2", builtin: true }), ["net"], SYNC);
    expect(h.installWithConsent).toHaveBeenCalledWith(target({ id: "b3", version: "2.0.0", sourceId: "voltius" }), ["net"], SYNC);
  });

  it("uninstalls tombstoned entries present here", async () => {
    h.entries = [tombstone("p1"), tombstone("b1")];
    h.loaded = [loadedManifest("p1"), loadedManifest("b1")];
    h.market.installedMeta = [meta("p1")];
    h.seeded = new Map([["b1", seededEntry("b1")]]);

    await reconcileAfterBoot();

    expect(h.uninstallPlugin).toHaveBeenCalledWith("p1");
    expect(h.uninstallPlugin).toHaveBeenCalledWith("b1");
    expect(h.installWithConsent).not.toHaveBeenCalled();
    expect(seededIds()).toEqual([]);
  });

  it("excluded ids are left alone both ways", async () => {
    h.excluded = new Set(["p1", "p2", "p3"]);
    h.entries = [tombstone("p1"), synced("p2")];
    h.loaded = [loadedManifest("p1"), loadedManifest("p3")];
    h.market.installedMeta = [meta("p1"), meta("p3")];
    h.market.catalog = [entry({ id: "p2" })];

    await reconcileAfterBoot();

    expect(h.uninstallPlugin).not.toHaveBeenCalled();
    expect(h.installWithConsent).not.toHaveBeenCalled();
    expect(seededIds()).toEqual([]);
  });

  it("locked plugins are never uninstalled", async () => {
    h.policy = ["locked", "defaulted"];
    h.entries = [tombstone("locked"), tombstone("defaulted")];
    h.loaded = [loadedManifest("locked"), loadedManifest("defaulted")];
    h.market.installedMeta = [meta("locked"), meta("defaulted")];

    await reconcileAfterBoot();

    expect(h.uninstallPlugin).not.toHaveBeenCalled();
  });

  it("leaves a local plugin sharing a removed id alone", async () => {
    h.entries = [tombstone("p1"), tombstone("dev")];
    h.loaded = [loadedManifest("p1"), loadedManifest("dev")];
    h.market.installedMeta = [meta("p1", { sourceId: "local" })];

    await reconcileAfterBoot();

    expect(h.uninstallPlugin).not.toHaveBeenCalled();
  });

  it("installs blocked by policy are skipped", async () => {
    h.blocked = new Set(["p2"]);
    h.entries = [synced("p2")];
    h.market.catalog = [entry({ id: "p2" })];

    await reconcileAfterBoot();

    expect(h.installWithConsent).not.toHaveBeenCalled();
  });

  it("skips retired and unverifiable entries", async () => {
    h.entries = [
      synced("plugin-ssh-config"),
      synced("nohash", { hash: null }),
      synced("norepo", { repo: "" }),
      synced("gone", { deleted_at: "2026-11-17T01:00:00Z" }),
    ];
    h.market.catalog = [entry({ id: "plugin-ssh-config" }), entry({ id: "other" })];

    await reconcileAfterBoot();

    expect(h.installWithConsent).not.toHaveBeenCalled();
    expect(h.uninstallPlugin).not.toHaveBeenCalled();
  });

  it("grown permissions queue consent instead of installing", async () => {
    h.entries = [synced("p2"), synced("p3", { source_id: "custom" })];
    h.market.catalog = [entry({ id: "p2" })];
    h.installWithConsent.mockResolvedValue({ ok: false, error: h.GREW });

    await reconcileAfterBoot();
    await reconcileAfterBoot();

    expect(queued()).toEqual(["p2", "p3"]);
    expect(h.toggleExcluded).not.toHaveBeenCalled();
  });

  it("review locked on always queues consent", async () => {
    h.locks = { [REVIEW_KEY]: true };
    h.entries = [
      synced("p2"),
      synced("p3", { source_id: "custom" }),
      synced("p5", { permissions: [] }),
      synced("nohash", { hash: null }),
    ];
    h.market.catalog = [entry({ id: "p2" }), entry({ id: "p5" })];

    await reconcileAfterBoot();

    expect(h.installWithConsent).not.toHaveBeenCalled();
    expect(queued()).toEqual(["p2", "p3", "p5"]);
  });

  it("review locked on queues consent for a plugin with no permissions", async () => {
    h.locks = { [REVIEW_KEY]: true };
    h.entries = [synced("p5", { permissions: [] })];
    h.market.catalog = [entry({ id: "p5", permissions: [] })];

    await reconcileAfterBoot();

    expect(h.installWithConsent).not.toHaveBeenCalled();
    expect(queued()).toEqual(["p5"]);
  });

  it("a review toggle locked off keeps the recorded consent", async () => {
    h.locks = { [REVIEW_KEY]: false };
    h.entries = [synced("p2")];
    h.market.catalog = [entry({ id: "p2" })];

    await reconcileAfterBoot();

    expect(h.installWithConsent).toHaveBeenCalledWith(target({ id: "p2" }), ["net"], SYNC);
  });

  it("failed install is retried, not excluded", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    h.entries = [synced("p2"), synced("p3", { source_id: "custom" })];
    h.market.catalog = [entry({ id: "p2" })];
    h.installWithConsent.mockResolvedValueOnce({ ok: false, error: "HTTP 404" }).mockRejectedValueOnce(new Error("offline"));

    await reconcileAfterBoot();
    await reconcileAfterBoot();

    expect(h.installWithConsent).toHaveBeenCalledTimes(4);
    expect(h.toggleExcluded).not.toHaveBeenCalled();
    expect(queued()).toEqual([]);
  });

  it("with the plugin type off nothing is installed, removed or queued", async () => {
    h.typeSynced = false;
    h.entries = [synced("remote-only"), tombstone("p1")];
    h.loaded = [loadedManifest("p1")];
    h.market.installedMeta = [meta("p1")];
    h.market.catalog = [entry({ id: "remote-only" })];
    h.installWithConsent.mockResolvedValue({ ok: false, error: h.GREW });

    await reconcileAfterBoot();

    expect(h.installWithConsent).not.toHaveBeenCalled();
    expect(h.uninstallPlugin).not.toHaveBeenCalled();
    expect(queued()).toEqual([]);
    expect(h.appToast).not.toHaveBeenCalled();
  });

  it("leaves ids the user is installing right now alone both ways", async () => {
    h.market.installing = new Set(["p1", "p2"]);
    h.entries = [tombstone("p1"), synced("p2")];
    h.loaded = [loadedManifest("p1")];
    h.market.installedMeta = [meta("p1")];
    h.market.catalog = [entry({ id: "p2" })];

    await reconcileAfterBoot();

    expect(h.uninstallPlugin).not.toHaveBeenCalled();
    expect(h.installWithConsent).not.toHaveBeenCalled();
  });

  it("does not reinstall a plugin that is on disk but failed to load", async () => {
    h.entries = [synced("broken")];
    h.market.installedMeta = [meta("broken")];
    h.market.catalog = [entry({ id: "broken" })];

    await reconcileAfterBoot();

    expect(h.installWithConsent).not.toHaveBeenCalled();
    expect(h.appToast).not.toHaveBeenCalled();
  });

  it("seeds installed plugins without removal markers", async () => {
    h.policy = ["pol"];
    h.entries = [synced("known")];
    h.loaded = ["ext", "b1", "b2", "loc", "pol", "known", "orphan"].map((id) => loadedManifest(id, [`perm-${id}`]));
    h.market.installedMeta = [
      meta("ext", { cssHash: "c-ext" }),
      meta("loc", { sourceId: "local", hash: null, repo: undefined }),
      meta("pol"),
      meta("known"),
    ];
    h.seeded = new Map([["b1", seededEntry("b1")], ["b2", seededEntry("b2")]]);
    h.market.catalog = [
      entry({ id: "b1", sourceId: "third", repo: "evil/b1", hash: "bad" }),
      entry({ id: "b1", repo: "o/b1", hash: "h-b1", cssHash: "c-b1" }),
    ];

    await reconcileAfterBoot();

    expect(h.seed).toHaveBeenCalledTimes(1);
    const items = h.seed.mock.calls[0][0];
    expect(items).toEqual([
      { id: "ext", repo: "o/ext", source_id: "voltius", hash: "h-ext", css_hash: "c-ext", permissions: ["perm-ext"], name: "Name ext" },
      { id: "b1", repo: "o/b1", source_id: "voltius", hash: "h-b1", css_hash: "c-b1", permissions: ["perm-b1"], name: "Name b1" },
      { id: "b2", repo: "", source_id: "voltius", hash: null, css_hash: null, permissions: ["perm-b2"], name: "Name b2" },
    ]);
    expect(items.some((i) => "deleted_at" in i)).toBe(false);
  });
});

const toastAction = () => h.appToast.mock.calls[0][2].action as { label: string; onClick: () => void };

describe("notifySyncedChanges", () => {
  beforeEach(() => {
    h.entries = [synced("p1", { name: "Alpha" }), synced("p2", { name: "Beta" })];
  });

  it("toasts nothing for empty lists", () => {
    notifySyncedChanges([], []);

    expect(h.appToast).not.toHaveBeenCalled();
  });

  it("names the plugin and the device for a single install", () => {
    h.manifests = { "dev-b": { deviceName: "Laptop" } };
    notifySyncedChanges(["p1"], []);

    expect(h.appToast).toHaveBeenCalledTimes(1);
    expect(h.appToast.mock.calls[0][0]).toBe("info");
    expect(h.appToast.mock.calls[0][1]).toBe(
      'settings.plugins.sync.installedOne|{"plugin":"Alpha","device":"Laptop"}',
    );
    expect(toastAction().label).toContain("settings.plugins.sync.notHere");
  });

  it("falls back to the lan-known name", () => {
    h.known = { "dev-b": { name: "Phone" } };
    notifySyncedChanges(["p1"], []);

    expect(h.appToast.mock.calls[0][1]).toContain('"device":"Phone"');
  });

  it("uses the unknown-device form when the device has no name", () => {
    notifySyncedChanges([], ["p1"]);

    expect(h.appToast.mock.calls[0][1]).toBe('settings.plugins.sync.removedOneUnknown|{"plugin":"Alpha"}');
    expect(toastAction().label).toContain("settings.plugins.sync.keepHere");
  });

  it("falls back to the id when the entry has no name", () => {
    h.entries = [synced("p1", { name: "" })];
    notifySyncedChanges(["p1"], []);

    expect(h.appToast.mock.calls[0][1]).toContain('"plugin":"p1"');
  });

  it("summarises several plugins with a count", () => {
    notifySyncedChanges(["p1", "p2"], []);

    expect(h.appToast.mock.calls[0][1]).toBe('settings.plugins.sync.installedMany|{"count":2}');
  });

  it("raises one toast per non-empty list", () => {
    notifySyncedChanges(["p1"], ["p2", "p1"]);

    expect(h.appToast).toHaveBeenCalledTimes(2);
    expect(h.appToast.mock.calls[1][1]).toBe('settings.plugins.sync.removedMany|{"count":2}');
  });

  it("Not on this device excludes then uninstalls", async () => {
    const order: string[] = [];
    h.toggleExcluded.mockImplementation(() => order.push("exclude"));
    h.uninstallPlugin.mockImplementation(async (id: string) => {
      order.push("uninstall");
      return { ok: true, result: { id } };
    });
    notifySyncedChanges(["p1"], []);

    toastAction().onClick();
    await vi.waitFor(() => expect(h.uninstallPlugin).toHaveBeenCalledWith("p1"));

    expect(order).toEqual(["exclude", "uninstall"]);
  });

  it("Keep on this device excludes then installs the resolved row", async () => {
    h.market.catalog = [entry({ id: "p1" })];
    const order: string[] = [];
    h.toggleExcluded.mockImplementation(() => order.push("exclude"));
    h.installWithConsent.mockImplementation(async () => {
      order.push("install");
      return { ok: true, result: {} };
    });
    notifySyncedChanges([], ["p1"]);

    toastAction().onClick();
    await vi.waitFor(() => expect(h.installWithConsent).toHaveBeenCalled());

    expect(order).toEqual(["exclude", "install"]);
    expect(h.installWithConsent).toHaveBeenCalledWith(target({ id: "p1" }), ["net"], SYNC);
  });
});

describe("keep actions", () => {
  it("do not re-toggle an id that is already excluded", async () => {
    h.entries = [synced("p1")];
    h.market.catalog = [entry({ id: "p1" })];
    h.excluded.add("p1");

    await keepOffThisDevice(["p1"]);
    await keepOnThisDevice(["p1"]);

    expect(h.toggleExcluded).not.toHaveBeenCalled();
  });

  it("keepOnThisDevice installs a recorded repo and hash that the catalogue lacks", async () => {
    h.entries = [synced("p9")];

    await keepOnThisDevice(["p9"]);

    expect(h.installWithConsent).toHaveBeenCalledWith(
      target({ id: "p9", repo: "o/p9", hash: "h-p9" }),
      ["net"],
      SYNC,
    );
  });

  it("keepOnThisDevice queues consent when review is locked on, marked as kept", async () => {
    h.locks = { [REVIEW_KEY]: true };
    h.entries = [tombstone("p1")];
    h.market.catalog = [entry({ id: "p1" })];

    await keepOnThisDevice(["p1"]);

    expect(h.installWithConsent).not.toHaveBeenCalled();
    expect(useSyncedPluginConsentStore.getState().queue).toEqual([{ id: "p1", keep: true }]);
  });

  it("keepOnThisDevice queues consent when permissions grew", async () => {
    h.entries = [tombstone("p1")];
    h.market.catalog = [entry({ id: "p1" })];
    h.installWithConsent.mockResolvedValue({ ok: false, error: h.GREW });

    await keepOnThisDevice(["p1"]);

    expect(useSyncedPluginConsentStore.getState().queue).toEqual([{ id: "p1", keep: true }]);
  });

  it("keepOffThisDevice swallows a failed removal", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    h.uninstallPlugin.mockRejectedValueOnce(new Error("busy")).mockResolvedValueOnce({ ok: false, error: "locked" });

    await expect(keepOffThisDevice(["p1", "p2"])).resolves.toBeUndefined();

    expect(h.excluded).toEqual(new Set(["p1", "p2"]));
    expect(h.uninstallPlugin).toHaveBeenCalledTimes(2);
  });

  it("resolveSyncedCandidate is null for an unknown id and for an entry with no source", async () => {
    h.entries = [synced("p3", { hash: null })];

    expect(await resolveSyncedCandidate("nope")).toBeNull();
    expect(await resolveSyncedCandidate("p3")).toBeNull();
  });
});

describe("consentStillWanted", () => {
  it("wants a live, synced, allowed entry that is not loaded", () => {
    h.entries = [synced("p1")];

    expect(consentStillWanted({ id: "p1", keep: false })).toBe(true);
  });

  it("drops an entry removed, excluded or turned off since it was queued", () => {
    h.entries = [tombstone("dead"), synced("off")];
    h.excluded.add("off");

    expect(consentStillWanted({ id: "dead", keep: false })).toBe(false);
    expect(consentStillWanted({ id: "off", keep: false })).toBe(false);
    expect(consentStillWanted({ id: "missing", keep: false })).toBe(false);
    h.typeSynced = false;
    h.entries = [synced("p1")];
    expect(consentStillWanted({ id: "p1", keep: false })).toBe(false);
  });

  it("drops an id blocked by policy or already loaded, even when kept", () => {
    h.entries = [synced("p1"), synced("p2")];
    h.blocked = new Set(["p1"]);
    h.loaded = [loadedManifest("p2")];

    expect(consentStillWanted({ id: "p1", keep: true })).toBe(false);
    expect(consentStillWanted({ id: "p2", keep: true })).toBe(false);
  });

  it("a kept removal stays wanted although its entry is removed and excluded", () => {
    h.entries = [tombstone("p1")];
    h.excluded.add("p1");

    expect(consentStillWanted({ id: "p1", keep: true })).toBe(true);
  });
});
