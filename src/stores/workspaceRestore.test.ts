import { test, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  reconnect: vi.fn(async () => undefined),
  restoreSessions: vi.fn(),
  removeSession: vi.fn(),
  hydrate: vi.fn(),
  snapshot: {
    version: 1,
    sessions: [{ id: "s1", connectionId: "c1", connectionName: "host", type: "ssh", persist: true }],
    layout: { splitTabs: [], activeSplitTabId: null, splitTabActive: false, titlebarOrder: [] },
    activeSessionId: "s1",
  },
}));

vi.mock("./workspaceSnapshotStore", () => ({
  readWorkspaceSnapshot: () => h.snapshot,
  clearWorkspaceSnapshot: vi.fn(),
  startWorkspaceSnapshotSync: vi.fn(),
}));
vi.mock("./toggleSettingsStore", () => ({ getToggle: () => true }));
vi.mock("./liveSessionManifestCore", () => ({ resolveRemoteSessions: () => ({ closedIds: [] }) }));
vi.mock("./crossDeviceSessionsStore", () => ({
  useCrossDeviceSessionsStore: { getState: () => ({ manifests: {}, tombstones: {} }) },
}));
vi.mock("./sessionStore", () => ({
  useSessionStore: {
    getState: () => ({
      sessions: [],
      restoreSessions: h.restoreSessions,
      removeSession: h.removeSession,
      reconnect: h.reconnect,
      markConnected: vi.fn(),
      markError: vi.fn(),
    }),
  },
}));
vi.mock("./layoutStore", () => ({
  useLayoutStore: { getState: () => ({ splitTabs: [], hydrate: h.hydrate, removeSession: h.removeSession }) },
  getPaneSessionIds: () => [],
}));
vi.mock("./uiStore", () => ({
  useUIStore: { getState: () => ({ setActiveNav: vi.fn(), setSidebarOpen: vi.fn() }) },
}));
vi.mock("@/services/local", () => ({ localConnect: vi.fn(async () => undefined) }));
vi.mock("@/hooks/useTerminal", () => ({ setRestoreScrollOffset: vi.fn() }));

const flush = () => new Promise((resolve) => setTimeout(resolve, 250));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules(); // workspaceRestore is one-shot per module instance
});

afterEach(async () => {
  const { resolveLoginSync } = await import("@/services/loginSyncGate");
  resolveLoginSync();
});

/**
 * A switch lands here with the config dir wiped: reconnecting before the cloud
 * pull refills it finds no connection and errors every restored tab.
 */
test("reconnect waits for the replace-sync that refills the wiped config dir", async () => {
  const { setLoginSyncPending, resolveLoginSync } = await import("@/services/loginSyncGate");
  const { restoreWorkspaceOnLaunch } = await import("./workspaceRestore");
  setLoginSyncPending({ replace: true });

  const restored = restoreWorkspaceOnLaunch();
  await flush();

  expect(h.restoreSessions).toHaveBeenCalled(); // tabs paint immediately
  expect(h.reconnect).not.toHaveBeenCalled();

  resolveLoginSync();
  await restored;
  expect(h.reconnect).toHaveBeenCalledWith("s1", { restore: true });
});

test("a normal launch reconnects without waiting on sync", async () => {
  const { setLoginSyncPending } = await import("@/services/loginSyncGate");
  const { restoreWorkspaceOnLaunch } = await import("./workspaceRestore");
  setLoginSyncPending(); // merge-mode: the local cache is already on disk

  await restoreWorkspaceOnLaunch();

  expect(h.reconnect).toHaveBeenCalledWith("s1", { restore: true });
});
