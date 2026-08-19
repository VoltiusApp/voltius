import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { usePluginStateStore } from "@/stores/pluginStateStore";
import { __resetGistSyncStateWarnings } from "@/services/syncStatus";

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

const PLUGIN_ID = "plugin-gist-sync";

// TitleBar pulls in a large dependency graph that vitest must cold-transform
// on first import. Under load that transform alone can exceed the default
// 5s test timeout, so it's paid once here in beforeAll (unbounded by any
// single test's timeout) rather than inside each test via a per-test import.
let TitleBar: (typeof import("./TitleBar"))["default"];
beforeAll(async () => {
  ({ default: TitleBar } = await import("./TitleBar"));
}, 20000);

beforeEach(() => {
  usePluginStateStore.setState({ values: new Map() });
  __resetGistSyncStateWarnings();
});
afterEach(cleanup);

// The literal live-gate bug: gist-sync published `sync-state.lastSync` as an ISO
// string instead of a Date, and TitleBar's SyncIndicator called
// `lastSync.toLocaleTimeString()` on it, white-screening the whole app
// (root.children dropped to 0). This renders the real TitleBar against that exact
// malformed publish and proves it no longer crashes.
describe("TitleBar + malformed gist-sync state", () => {
  test("renders without throwing when lastSync is published as an ISO string", () => {
    usePluginStateStore.getState().publish(PLUGIN_ID, "sync-state", {
      status: "success",
      lastSync: "2026-01-01T00:00:00.000Z",
      error: null,
      blobSizeBytes: 1024,
      configured: true,
    });

    expect(() => render(<TitleBar />)).not.toThrow();
  });

  test("renders without throwing when lastSync is published as unparseable garbage", () => {
    usePluginStateStore.getState().publish(PLUGIN_ID, "sync-state", {
      status: "success",
      lastSync: "not-a-date",
      error: null,
      blobSizeBytes: null,
      configured: true,
    });

    expect(() => render(<TitleBar />)).not.toThrow();
  });
});
