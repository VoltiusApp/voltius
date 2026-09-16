import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { usePluginStateStore } from "@/stores/pluginStateStore";
import { __resetPluginStateWarnings } from "@/services/syncStatus";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    startDragging: vi.fn(),
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/utils/icons", () => ({
  getConnectionIcon: () => null,
  getConnectionIconColor: () => null,
}));

import { loadPlugin, unloadPlugin } from "@/plugins/runtime";
import type { PluginManifest } from "@/plugins/api";

const providerManifest = (id: string, name: string): PluginManifest =>
  ({ id, name, version: "1.0.0", permissions: ["sync:write", "ui"] });

function loadProvider(id: string, name: string, state: unknown) {
  loadPlugin(providerManifest(id, name), (api) => {
    api.plugins.expose({ syncNow: async () => {} });
  }, true);
  usePluginStateStore.getState().publish(id, "sync-state", state);
}

let TitleBar: (typeof import("./TitleBar"))["default"];
beforeAll(async () => {
  ({ default: TitleBar } = await import("./TitleBar"));
}, 20000);

const loaded: string[] = [];
beforeEach(() => {
  usePluginStateStore.setState({ values: new Map() });
  __resetPluginStateWarnings();
});
afterEach(() => {
  cleanup();
  while (loaded.length) unloadPlugin(loaded.pop()!);
});

const provider = (id: string, name: string, state: unknown) => {
  loadProvider(id, name, state);
  loaded.push(id);
};

const syncButtonTitle = (container: HTMLElement) =>
  [...container.querySelectorAll("button[title^='layout.sync.status.']")].map((b) => b.getAttribute("title"));

describe("TitleBar sync icon across providers", () => {
  test("a failing provider wins over a syncing one and names its source", () => {
    provider("plugin-a-sync", "A Sync", { status: "syncing", lastSync: null, error: null, blobSizeBytes: null, configured: true });
    provider("plugin-b-sync", "B Sync", { status: "error", lastSync: null, error: "Sync token is invalid or expired", blobSizeBytes: null, configured: true });
    const { container } = render(<TitleBar />);
    expect(syncButtonTitle(container)).toContain("layout.sync.status.errorDetailFrom");
  });

  test("syncing wins over success", () => {
    provider("plugin-a-sync", "A Sync", { status: "syncing", lastSync: null, error: null, blobSizeBytes: null, configured: true });
    provider("plugin-b-sync", "B Sync", { status: "success", lastSync: new Date(), error: null, blobSizeBytes: null, configured: true });
    vi.useFakeTimers();
    try {
      const { container } = render(<TitleBar />);
      // useSyncMotion only reports "syncing" once its background-delay timer fires;
      // advance past it so the icon reflects the aggregated engine status.
      act(() => { vi.advanceTimersByTime(500); });
      expect(syncButtonTitle(container)).toContain("layout.sync.status.syncing");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("TitleBar + malformed provider state", () => {
  test("renders when lastSync is published as an ISO string", () => {
    provider("plugin-a-sync", "A Sync", { status: "success", lastSync: "2026-01-01T00:00:00.000Z", error: null, blobSizeBytes: 1024, configured: true });
    expect(() => render(<TitleBar />)).not.toThrow();
  });

  test("renders when lastSync is unparseable garbage", () => {
    provider("plugin-a-sync", "A Sync", { status: "success", lastSync: "not-a-date", error: null, blobSizeBytes: null, configured: true });
    expect(() => render(<TitleBar />)).not.toThrow();
  });
});
