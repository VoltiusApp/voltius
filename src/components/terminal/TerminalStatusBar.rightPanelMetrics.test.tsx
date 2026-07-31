import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { TerminalStatusBar } from "./TerminalStatusBar";
import { usePluginStore } from "@/stores/pluginStore";
import { useUIStore } from "@/stores/uiStore";
import * as metricsService from "@/services/metrics";

// Pins the two things a wrong template-string could silently break without the
// suite noticing: the active-state comparison (`rightPanelSection === "plugin:${id}"`)
// and the id handed to toggleRightPanel on click. Both read from the same
// `metricsSectionId` (found via the providesHostMetrics flag), not a literal id.

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/utils/icons", () => ({
  getDistroIcon: () => "x", getDistroColor: () => "x", getDistroLabel: (d: string) => d,
}));
vi.mock("@/services/metrics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/metrics")>();
  return {
    ...actual,
    metricsStart: vi.fn(async () => "stream-1"),
    metricsStop: vi.fn(async () => {}),
    onMetricsSnapshot: vi.fn((_streamId: string, cb: (s: unknown) => void) => {
      capturedSnapshotCb = cb;
      return Promise.resolve(() => {});
    }),
  };
});

let capturedSnapshotCb: ((s: unknown) => void) | null = null;

const sampleMetrics = {
  ts: 1, cpu_percent: 12, mem_used_kb: 1024, mem_total_kb: 4096,
  net_rx_bytes_per_sec: 0, net_tx_bytes_per_sec: 0, disks: null,
};

async function renderWithMetrics(rightPanelSection: string) {
  capturedSnapshotCb = null;
  useUIStore.setState({ rightPanelOpen: true, rightPanelSection });
  render(
    <TerminalStatusBar sessionId="s1" sessionType="ssh" connectionId="c1" sessionStatus="connected" />,
  );
  await waitFor(() => expect(metricsService.metricsStart).toHaveBeenCalled());
  await waitFor(() => expect(capturedSnapshotCb).not.toBeNull());
  act(() => capturedSnapshotCb!(sampleMetrics));
  await waitFor(() => expect(screen.getByTitle("terminal.statusBar.systemMetricsTitle")).toBeTruthy());
  return screen.getByTitle("terminal.statusBar.systemMetricsTitle");
}

beforeEach(() => {
  usePluginStore.setState({ rightPanelSections: new Map() });
  usePluginStore.getState().registerRightPanelSection({
    id: "acme:metrics", label: "Metrics", icon: "x", component: () => null, providesHostMetrics: true,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useUIStore.setState({ rightPanelOpen: false, rightPanelSection: "themes" });
});

describe("TerminalStatusBar metrics chip — id resolved via providesHostMetrics", () => {
  test("active-state background is set when rightPanelSection matches `plugin:${flaggedSectionId}`", async () => {
    const button = await renderWithMetrics("plugin:acme:metrics");
    expect(button.style.background).toBe("var(--t-bg-elevated)");
  });

  test("active-state background is NOT set when rightPanelSection points at a different (even similarly-named) section", async () => {
    const button = await renderWithMetrics("plugin:other:metrics");
    expect(button.style.background).toBe("");
  });

  test("clicking the chip targets the flagged section's namespaced id, not a literal string", async () => {
    const button = await renderWithMetrics("themes");
    fireEvent.click(button);
    expect(useUIStore.getState().rightPanelSection).toBe("plugin:acme:metrics");
    expect(useUIStore.getState().rightPanelOpen).toBe(true);
  });
});
