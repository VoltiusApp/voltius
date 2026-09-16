import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { USER_DATA_HANDLERS } from "@/services/user-data/registry";

const { mockT } = vi.hoisted(() => ({
  mockT: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${JSON.stringify(o)}` : k),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: mockT }) }));
vi.mock("@/i18n", () => ({ default: { t: mockT } }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@/services/sync", () => ({
  getSyncState: () => ({ status: "idle", lastSync: null, error: null, cloudActive: false, blobSizeBytes: null }),
  onSyncStateChange: () => () => {},
  syncNow: vi.fn(),
  scheduleSync: vi.fn(),
}));
const { view, defaultProviders, useSyncProvidersMock, resetProvidersMock } = vi.hoisted(() => {
  type ProviderOverride = Record<string, unknown>;
  const view = (over: ProviderOverride) => ({
    id: "x", label: "X", icon: "lucide:cloud", availability: "active",
    state: { status: "success", lastSync: null, error: null, blobSizeBytes: null, configured: true },
    syncNow: null, action: null, ...over,
  });
  const defaultProviders = () => [
    view({ id: "voltius", label: "Voltius Sync" }),
    view({ id: "plugin-cloudflare-sync", label: "Cloudflare Sync", availability: "disabled", action: { kind: "enable" } }),
    view({ id: "plugin-gist-sync", label: "GitHub Gist Sync", action: { kind: "configure", pageId: "plugin-gist-sync:gist-sync-settings" } }),
  ];
  const defaultReturn = () => ({
    providers: defaultProviders(),
    effective: { configured: true, status: "success", lastSync: null, error: null, errorSource: null },
  });
  const useSyncProvidersMock = vi.fn(defaultReturn);
  const resetProvidersMock = () => useSyncProvidersMock.mockImplementation(defaultReturn);
  return { view, defaultProviders, useSyncProvidersMock, resetProvidersMock };
});
vi.mock("@/hooks/useSyncProviders", () => ({ useSyncProviders: useSyncProvidersMock }));
const { availableCatalog } = vi.hoisted(() => ({ availableCatalog: { list: [] as unknown[] } }));
vi.mock("@/hooks/useAvailableSyncProviders", () => ({ useAvailableSyncProviders: () => ({ available: availableCatalog.list, appVersion: null }) }));
vi.mock("@/components/settings/usePluginInstaller", () => ({
  usePluginInstaller: () => ({ busy: new Set(), startInstall: vi.fn(), startUpdate: vi.fn(), modal: null }),
}));
const { runAction } = vi.hoisted(() => ({ runAction: vi.fn() }));
vi.mock("@/services/syncProviderAction", () => ({ runSyncProviderAction: runAction }));

import { scheduleSync } from "@/services/sync";
import SyncSection from "./SyncSection";

const toggleFor = (c: HTMLElement, domain: string) =>
  c.querySelector(`[data-sync-domain="${domain}"] button[role="switch"]`) as HTMLButtonElement | null;

describe("SyncSection settings domains", () => {
  beforeEach(() => useSyncPrefsStore.setState({ syncSettingDomains: {}, syncTypes: {}, excludedIds: [] }));
  afterEach(cleanup);

  test("renders a toggle for each settings domain and none for vaults", () => {
    const { container } = render(<SyncSection />);
    expect(toggleFor(container, "themes")).toBeTruthy();
    expect(toggleFor(container, "appSettings")).toBeTruthy();
    expect(toggleFor(container, "recentPeople")).toBeTruthy();
    expect(toggleFor(container, "vaults")).toBeNull();
  });

  test("switching a domain off records it", () => {
    const { container } = render(<SyncSection />);
    fireEvent.click(toggleFor(container, "themes")!);
    expect(useSyncPrefsStore.getState().isDomainSynced("themes")).toBe(false);
  });

  test("switching a domain back on publishes this device's values", () => {
    const themes = USER_DATA_HANDLERS.find((h) => h.key === "themes")!;
    const touch = vi.spyOn(themes, "touch").mockImplementation(() => {});
    useSyncPrefsStore.getState().setSyncSettingDomain("themes", false);
    const { container } = render(<SyncSection />);
    fireEvent.click(toggleFor(container, "themes")!);
    expect(touch).toHaveBeenCalled();
    touch.mockRestore();
  });

  test("switching a domain off does not touch it", () => {
    const themes = USER_DATA_HANDLERS.find((h) => h.key === "themes")!;
    const touch = vi.spyOn(themes, "touch").mockImplementation(() => {});
    const { container } = render(<SyncSection />);
    fireEvent.click(toggleFor(container, "themes")!);
    expect(touch).not.toHaveBeenCalled();
    touch.mockRestore();
  });

  test("switching a domain off schedules a push to withdraw the server copy", () => {
    const { container } = render(<SyncSection />);
    fireEvent.click(toggleFor(container, "themes")!);
    expect(scheduleSync).toHaveBeenCalled();
  });
});

describe("held-back settings summary", () => {
  // The file already mocks react-i18next, @/i18n, @iconify/react and
  // @/services/sync, and queries the DOM directly — jest-dom is not installed.
  const el = (c: HTMLElement, id: string) =>
    c.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

  beforeEach(() =>
    useSyncPrefsStore.setState({
      syncSettingDomains: {}, settingSyncOverrides: {}, syncTypes: {}, excludedIds: [],
    }),
  );
  afterEach(cleanup);

  test("counts the device-scoped default under App settings", () => {
    const { container } = render(<SyncSection />);
    expect(el(container, "held-back-appSettings")?.textContent).toContain("1");
  });

  test("lists a held-back key and resumes it", () => {
    useSyncPrefsStore.getState().setSettingSync("appSettings.locale", false);
    const { container } = render(<SyncSection />);
    fireEvent.click(el(container, "held-back-appSettings")!);
    fireEvent.click(el(container, "resume-appSettings.locale")!);
    expect(useSyncPrefsStore.getState().isSettingSynced("appSettings.locale")).toBe(true);
  });

  test("shows nothing for a domain with no held-back keys", () => {
    const { container } = render(<SyncSection />);
    expect(el(container, "held-back-shortcuts")).toBeNull();
  });

  test("shows nothing for a domain that is switched off entirely", () => {
    useSyncPrefsStore.getState().setSyncSettingDomain("appSettings", false);
    const { container } = render(<SyncSection />);
    expect(el(container, "held-back-appSettings")).toBeNull();
  });
});

describe("SyncSection Voltius group", () => {
  beforeEach(() => runAction.mockClear());
  afterEach(() => { cleanup(); resetProvidersMock(); });

  test("a signed-in free user's upgrade button routes through the shared provider action", () => {
    useSyncProvidersMock.mockImplementation(() => ({
      providers: [view({ id: "voltius", label: "Voltius Sync", availability: "needs_upgrade", action: { kind: "upgrade" } })],
      effective: { configured: false, status: "idle", lastSync: null, error: null, errorSource: null },
    }));
    const { getByText } = render(<SyncSection />);
    fireEvent.click(getByText("settings.sync.requiresPro.upgrade"));
    expect(runAction).toHaveBeenCalledWith({ kind: "upgrade" });
  });

  test("a signed-out user's sign-in button routes through the shared provider action", () => {
    useSyncProvidersMock.mockImplementation(() => ({
      providers: [view({ id: "voltius", label: "Voltius Sync", availability: "locked", action: { kind: "signIn" } })],
      effective: { configured: false, status: "idle", lastSync: null, error: null, errorSource: null },
    }));
    const { getByText } = render(<SyncSection />);
    fireEvent.click(getByText("settings.sync.notConnected.signIn"));
    expect(runAction).toHaveBeenCalledWith({ kind: "signIn" });
  });
});

describe("SyncSection plugin providers", () => {
  afterEach(() => { cleanup(); resetProvidersMock(); });

  const otherSync = {
    id: "plugin-other-sync", name: "Other Sync", author: "a", description: "d", repo: "", version: "1.0.0",
    tags: [], theme: false, sourceId: "voltius", permissions: ["sync:write"],
  };

  test("lists plugin providers without a hardcoded Gist group", () => {
    const { container, queryByText } = render(<SyncSection />);
    expect([...container.querySelectorAll("[data-sync-provider]")].map((e) => e.getAttribute("data-sync-provider")))
      .toEqual(["plugin-cloudflare-sync", "plugin-gist-sync"]);
    expect(queryByText("settings.sync.gistTitle")).toBeNull();
  });

  test("a disabled provider's button runs the enable action", () => {
    const { container } = render(<SyncSection />);
    const row = container.querySelector("[data-sync-provider='plugin-cloudflare-sync']")!;
    fireEvent.click(row.querySelector("button")!);
    expect(runAction).toHaveBeenCalledWith({ kind: "enable" });
  });

  test("a provider with a real syncNow renders Sync now and calls it on click", async () => {
    const syncNow = vi.fn(async () => {});
    useSyncProvidersMock.mockImplementation(() => ({
      providers: [
        ...defaultProviders(),
        view({ id: "plugin-real-sync", label: "Real Sync", syncNow }),
      ],
      effective: { configured: true, status: "success", lastSync: null, error: null, errorSource: null },
    }));
    const { container } = render(<SyncSection />);
    const row = container.querySelector("[data-sync-provider='plugin-real-sync']")!;
    const button = row.querySelector("button")!;
    expect(button.textContent).toContain("settings.sync.active.syncNow");
    fireEvent.click(button);
    await vi.waitFor(() => expect(syncNow).toHaveBeenCalledTimes(1));
  });

  test("installable providers are listed inside the Sync plugins group, after the installed ones", () => {
    availableCatalog.list = [otherSync];
    try {
      const { container, getByText, queryByText } = render(<SyncSection />);
      const group = getByText("settings.sync.providersTitle").parentElement!;
      const rows = [...group.querySelectorAll("[data-sync-provider], [data-available-sync-provider]")];
      expect(rows.map((r) => r.getAttribute("data-sync-provider") ?? r.getAttribute("data-available-sync-provider")))
        .toEqual(["plugin-cloudflare-sync", "plugin-gist-sync", "plugin-other-sync"]);
      expect(container.querySelectorAll("[data-available-sync-provider]")).toHaveLength(1);
      expect(queryByText("settings.sync.availableTitle")).toBeNull();
    } finally {
      availableCatalog.list = [];
    }
  });

  test("the Sync plugins group appears when only installable providers exist", () => {
    useSyncProvidersMock.mockImplementation(() => ({
      providers: [view({ id: "voltius", label: "Voltius Sync" })],
      effective: { configured: true, status: "success", lastSync: null, error: null, errorSource: null },
    }));
    availableCatalog.list = [otherSync];
    try {
      const { getByText } = render(<SyncSection />);
      const group = getByText("settings.sync.providersTitle").parentElement!;
      expect(group.querySelector("[data-available-sync-provider='plugin-other-sync']")).not.toBeNull();
    } finally {
      availableCatalog.list = [];
    }
  });
});
