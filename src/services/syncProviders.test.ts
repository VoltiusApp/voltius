// @vitest-environment jsdom
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import type { PluginManifest, SettingsPage } from "@/plugins/api";
import type { MarketplacePlugin } from "@/stores/marketplaceStore";
import { __resetPluginStateWarnings } from "./syncStatus";
import {
  aggregateSyncStatus,
  availableCatalogProviders,
  isNearbyOnly,
  buildSyncProviders,
  toSyncProviderSummary,
  type LoadedPluginInfo,
  type SyncProviderInputs,
} from "./syncProviders";

const manifest = (id: string, name: string, permissions: string[] = ["sync:write", "ui"]): PluginManifest =>
  ({ id, name, version: "1.0.0", permissions });

const plugin = (over: Partial<LoadedPluginInfo> & { manifest: PluginManifest }): LoadedPluginInfo => ({
  active: true,
  exposed: { syncNow: vi.fn(async () => {}) },
  publishedState: { status: "success", lastSync: new Date("2026-09-01T10:00:00Z"), error: null, blobSizeBytes: 10, configured: true },
  ...over,
});

const page = (id: string, icon: string): SettingsPage => ({ id, label: id, icon, component: () => null });

function inputs(over: Partial<SyncProviderInputs> = {}): SyncProviderInputs {
  return {
    voltius: {
      label: "Voltius Sync",
      state: { status: "success", lastSync: new Date("2026-09-01T09:00:00Z"), error: null, blobSizeBytes: null },
      accountMode: "server",
      isPro: true,
      paused: false,
      syncNow: vi.fn(async () => {}),
    },
    plugins: [],
    settingsPages: [],
    ...over,
  };
}

beforeEach(() => {
  __resetPluginStateWarnings();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("buildSyncProviders", () => {
  test("Voltius comes first, plugin providers follow sorted by label, non-providers are skipped", () => {
    const providers = buildSyncProviders(inputs({
      plugins: [
        plugin({ manifest: manifest("plugin-gist-sync", "GitHub Gist Sync") }),
        plugin({ manifest: manifest("plugin-docker", "Docker", ["ui"]) }),
        plugin({ manifest: manifest("plugin-cloudflare-sync", "Cloudflare Sync") }),
      ],
    }));
    expect(providers.map((p) => p.id)).toEqual(["voltius", "plugin-cloudflare-sync", "plugin-gist-sync"]);
  });

  test("Voltius availability follows account mode and plan", () => {
    const [signedOut] = buildSyncProviders(inputs({ voltius: { ...inputs().voltius, accountMode: "local" } }));
    expect(signedOut).toMatchObject({ availability: "locked", action: { kind: "signIn" }, syncNow: null });
    const [free] = buildSyncProviders(inputs({ voltius: { ...inputs().voltius, isPro: false } }));
    expect(free).toMatchObject({ availability: "needs_upgrade", action: { kind: "upgrade" }, syncNow: null });
    const [pro] = buildSyncProviders(inputs());
    expect(pro).toMatchObject({ availability: "active", action: null });
    expect(pro.state.configured).toBe(true);
  });

  test("only a Voltius provider that is syncing or paused can be switched", () => {
    const [active] = buildSyncProviders(inputs());
    expect(active.pauseToggle).toEqual({ kind: "pause" });
    const [paused] = buildSyncProviders(inputs({ voltius: { ...inputs().voltius, paused: true } }));
    expect(paused.pauseToggle).toEqual({ kind: "resume" });
    const [signedOut] = buildSyncProviders(inputs({ voltius: { ...inputs().voltius, accountMode: "local" } }));
    expect(signedOut.pauseToggle).toBeNull();
    const [free] = buildSyncProviders(inputs({ voltius: { ...inputs().voltius, isPro: false } }));
    expect(free.pauseToggle).toBeNull();
    const [, gist] = buildSyncProviders(inputs({ plugins: [plugin({ manifest: manifest("plugin-gist-sync", "GitHub Gist Sync") })] }));
    expect(gist.pauseToggle).toBeNull();
  });

  test("a paused Voltius provider keeps Sync now and offers to resume", () => {
    const [paused] = buildSyncProviders(inputs({ voltius: { ...inputs().voltius, paused: true } }));
    expect(paused).toMatchObject({ availability: "paused", action: { kind: "resume" } });
    expect(paused.syncNow).not.toBeNull();
    expect(paused.state.configured).toBe(false);
  });

  test("a signed-out account is asked to sign in even if this device is paused", () => {
    const [signedOut] = buildSyncProviders(inputs({ voltius: { ...inputs().voltius, accountMode: "local", paused: true } }));
    expect(signedOut.availability).toBe("locked");
  });

  test("a pause set before a downgrade stays visible so it can still be lifted", () => {
    const [free] = buildSyncProviders(inputs({ voltius: { ...inputs().voltius, isPro: false, paused: true } }));
    expect(free).toMatchObject({ availability: "paused", action: { kind: "resume" } });
  });

  test("plugin availability: disabled, not configured, never published, active", () => {
    const providers = buildSyncProviders(inputs({
      plugins: [
        plugin({ manifest: manifest("a", "A"), active: false, exposed: null, publishedState: undefined }),
        plugin({ manifest: manifest("b", "B"), publishedState: { status: "idle", lastSync: null, error: null, blobSizeBytes: null, configured: false } }),
        plugin({ manifest: manifest("c", "C"), publishedState: undefined }),
        plugin({ manifest: manifest("d", "D") }),
      ],
      settingsPages: [page("b:settings", "lucide:box")],
    }));
    const byId = Object.fromEntries(providers.map((p) => [p.id, p]));
    expect(byId.a).toMatchObject({ availability: "disabled", action: { kind: "enable" }, syncNow: null });
    expect(byId.b).toMatchObject({ availability: "not_configured", action: { kind: "configure", pageId: "b:settings" }, icon: "lucide:box" });
    expect(byId.c).toMatchObject({ availability: "not_configured", action: { kind: "configure", pageId: null }, icon: "lucide:refresh-cw" });
    expect(byId.d.availability).toBe("active");
    expect(typeof byId.d.syncNow).toBe("function");
  });

  test("a settings page is attributed to the longest matching plugin id", () => {
    const providers = buildSyncProviders(inputs({
      plugins: [plugin({ manifest: manifest("plugin-sync", "S") }), plugin({ manifest: manifest("plugin-sync-extra", "X") })],
      settingsPages: [page("plugin-sync-extra:settings", "lucide:star")],
    }));
    expect(providers.find((p) => p.id === "plugin-sync")?.icon).toBe("lucide:refresh-cw");
    expect(providers.find((p) => p.id === "plugin-sync-extra")?.icon).toBe("lucide:star");
  });

  test("an exposed API without a syncNow function leaves syncNow null and warns once", () => {
    const build = () => buildSyncProviders(inputs({ plugins: [plugin({ manifest: manifest("p", "P"), exposed: { syncNow: "nope" } })] }));
    expect(build()[1].syncNow).toBeNull();
    build();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  test("an exposed API with a throwing getter never throws", () => {
    const exposed = Object.defineProperty({}, "syncNow", { get() { throw new Error("boom"); } });
    expect(() => buildSyncProviders(inputs({ plugins: [plugin({ manifest: manifest("p", "P"), exposed })] }))).not.toThrow();
  });

  test("a malformed published state is sanitized", () => {
    const [, p] = buildSyncProviders(inputs({ plugins: [plugin({ manifest: manifest("p", "P"), publishedState: { status: "success", lastSync: "garbage", error: null, blobSizeBytes: null, configured: true } })] }));
    expect(p.state.lastSync).toBeNull();
  });
});

describe("aggregateSyncStatus", () => {
  const providersWith = (...states: Array<{ status: string; lastSync?: string | null; error?: string | null }>) =>
    buildSyncProviders(inputs({
      voltius: { ...inputs().voltius, accountMode: "local" },
      plugins: states.map((s, i) => plugin({
        manifest: manifest(`p${i}`, `P${i}`),
        publishedState: { status: s.status, lastSync: s.lastSync ?? null, error: s.error ?? null, blobSizeBytes: null, configured: true },
      })),
    }));

  test("no providers still carries the nearby count", () => {
    expect(aggregateSyncStatus([], 2)).toMatchObject({ configured: false, nearby: 2 });
    expect(aggregateSyncStatus([]).nearby).toBe(0);
    expect(aggregateSyncStatus(providersWith({ status: "success" }), 3).nearby).toBe(3);
  });

  test("nearby never masks an error, even when unconfigured", () => {
    const base = aggregateSyncStatus([], 2);
    expect(isNearbyOnly(base)).toBe(true);
    expect(isNearbyOnly({ ...base, status: "error" })).toBe(false);
  });

  test("worst status wins and the error names its provider", () => {
    const effective = aggregateSyncStatus(providersWith({ status: "syncing" }, { status: "error", error: "Sync token is invalid or expired" }, { status: "offline" }));
    expect(effective).toMatchObject({ configured: true, status: "error", error: "Sync token is invalid or expired", errorSource: "P1" });
  });

  test("an unreachable provider keeps its reason but is not named as a failing source", () => {
    const effective = aggregateSyncStatus(providersWith({ status: "success" }, { status: "offline", error: "connection refused" }));
    expect(effective).toMatchObject({ status: "offline", error: "connection refused", errorSource: null, nearby: 0 });
  });

  test("rank order is error > offline > syncing > success > idle", () => {
    expect(aggregateSyncStatus(providersWith({ status: "syncing" }, { status: "offline" })).status).toBe("offline");
    expect(aggregateSyncStatus(providersWith({ status: "success" }, { status: "syncing" })).status).toBe("syncing");
    expect(aggregateSyncStatus(providersWith({ status: "idle" }, { status: "success" })).status).toBe("success");
  });

  test("lastSync is the most recent success across active providers, errors are dropped when not failing", () => {
    const effective = aggregateSyncStatus(providersWith(
      { status: "success", lastSync: "2026-09-01T08:00:00Z", error: "stale" },
      { status: "success", lastSync: "2026-09-02T08:00:00Z" },
    ));
    expect(effective.lastSync?.toISOString()).toBe("2026-09-02T08:00:00.000Z");
    expect(effective).toMatchObject({ error: null, errorSource: null });
  });

  test("inactive providers are ignored", () => {
    const providers = buildSyncProviders(inputs({
      plugins: [plugin({ manifest: manifest("p", "P"), active: false, publishedState: { status: "error", lastSync: null, error: "x", blobSizeBytes: null, configured: true } })],
    }));
    expect(aggregateSyncStatus(providers).status).toBe("success");
  });

  test("with no active provider it falls back to the Voltius state, unconfigured", () => {
    const providers = buildSyncProviders(inputs({ voltius: { ...inputs().voltius, accountMode: "local", state: { status: "idle", lastSync: null, error: null, blobSizeBytes: null } } }));
    expect(aggregateSyncStatus(providers)).toEqual({ configured: false, paused: false, status: "idle", lastSync: null, error: null, errorSource: null, nearby: 0 });
  });

  test("a free account's refused cloud sync is not an error, so nearby devices still show", () => {
    const providers = buildSyncProviders(inputs({
      voltius: { ...inputs().voltius, isPro: false, state: { status: "error", lastSync: null, error: "Server error: 402", blobSizeBytes: null } },
    }));
    const effective = aggregateSyncStatus(providers, 1);
    expect(effective).toMatchObject({ configured: false, status: "idle", error: null });
    expect(isNearbyOnly(effective)).toBe(true);
  });

  test("a paused Voltius provider is left out of the status and reported as paused", () => {
    const providers = buildSyncProviders(inputs({
      voltius: { ...inputs().voltius, paused: true, state: { status: "error", lastSync: null, error: "unreachable", blobSizeBytes: null } },
    }));
    expect(aggregateSyncStatus(providers)).toMatchObject({ configured: false, paused: true });
  });

  test("an active plugin provider still drives the status while Voltius is paused", () => {
    const providers = buildSyncProviders(inputs({
      voltius: { ...inputs().voltius, paused: true },
      plugins: [plugin({ manifest: manifest("p", "P") })],
    }));
    expect(aggregateSyncStatus(providers)).toMatchObject({ configured: true, paused: false, status: "success" });
  });

  test("when Voltius and a plugin both fail, the first provider in the list wins the tie", () => {
    const providers = buildSyncProviders(inputs({
      plugins: [plugin({
        manifest: manifest("p", "P"),
        publishedState: { status: "error", lastSync: null, error: "plugin exploded", blobSizeBytes: null, configured: true },
      })],
      voltius: { ...inputs().voltius, state: { status: "error", lastSync: null, error: "voltius exploded", blobSizeBytes: null } },
    }));
    expect(aggregateSyncStatus(providers)).toMatchObject({ status: "error", error: "voltius exploded", errorSource: "Voltius Sync" });
  });
});

describe("availableCatalogProviders", () => {
  const entry = (id: string, permissions: string[] | undefined, sourceId = "voltius", builtin?: boolean): MarketplacePlugin =>
    ({ id, name: id, author: "a", description: "", repo: "", version: "1.0.0", tags: [], theme: false, sourceId, permissions, builtin });

  test("keeps uninstalled sync:write entries once, in catalogue order", () => {
    const result = availableCatalogProviders(
      [
        entry("plugin-ssh-config", ["connections:read"]),
        entry("plugin-cloudflare-sync", ["sync:write"]),
        entry("plugin-gist-sync", ["sync:write"]),
        entry("plugin-cloudflare-sync", ["sync:write"], "custom"),
        entry("legacy", undefined),
      ],
      new Set(["plugin-gist-sync"]),
    );
    expect(result.map((p) => [p.id, p.sourceId])).toEqual([["plugin-cloudflare-sync", "voltius"]]);
  });

  test("the first source for an id wins even when it doesn't qualify, so a later untrusted duplicate never surfaces", () => {
    const result = availableCatalogProviders(
      [
        entry("plugin-cloudflare-sync", undefined, "voltius"),
        entry("plugin-cloudflare-sync", ["sync:write"], "untrusted"),
      ],
      new Set(),
    );
    expect(result).toEqual([]);
  });

  test("a builtin catalogue entry with sync:write is included", () => {
    const result = availableCatalogProviders([entry("plugin-gist-sync", ["sync:write"], "voltius", true)], new Set());
    expect(result.map((p) => p.id)).toEqual(["plugin-gist-sync"]);
  });
});

describe("toSyncProviderSummary", () => {
  test("serialises lastSync to ISO and drops functions", () => {
    const [voltius] = buildSyncProviders(inputs());
    expect(toSyncProviderSummary(voltius)).toEqual({
      id: "voltius", label: "Voltius Sync", availability: "active", status: "success",
      lastSync: "2026-09-01T09:00:00.000Z", error: null,
    });
  });
});
