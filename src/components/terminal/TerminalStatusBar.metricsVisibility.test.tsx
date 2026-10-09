import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor, cleanup } from "@testing-library/react";
import { TerminalStatusBar } from "./TerminalStatusBar";
import { usePluginStore } from "@/stores/pluginStore";
import * as metricsService from "@/services/metrics";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, o?: { pct?: string }) => (o?.pct ? `cpu ${o.pct}` : key) }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/utils/icons", () => ({
  getDistroIcon: () => "x", getDistroColor: () => "x", getDistroLabel: (d: string) => d,
}));

let streams = 0;
const unlistens: ReturnType<typeof vi.fn>[] = [];
let snapshotCb: ((s: metricsService.MetricsSnapshot) => void) | null = null;

vi.mock("@/services/metrics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/metrics")>()),
  metricsStart: vi.fn(async () => `stream-${++streams}`),
  metricsStop: vi.fn(async () => {}),
  onMetricsSnapshot: vi.fn((_id: string, cb: (s: metricsService.MetricsSnapshot) => void) => {
    snapshotCb = cb;
    const off = vi.fn();
    unlistens.push(off);
    return Promise.resolve(off);
  }),
}));

const snapshot = (cpu: number): metricsService.MetricsSnapshot => ({
  ts: 1, cpu_percent: cpu, mem_used_kb: 1024, mem_total_kb: 4096,
  net_rx_bytes_per_sec: 0, net_tx_bytes_per_sec: 0, disks: null,
});

const bar = (visible: boolean) => (
  <TerminalStatusBar sessionId="s1" sessionType="ssh" connectionId="c1" sessionStatus="connected" visible={visible} />
);

beforeEach(() => {
  streams = 0;
  unlistens.length = 0;
  snapshotCb = null;
  usePluginStore.setState({ rightPanelSections: new Map() });
  usePluginStore.getState().registerRightPanelSection({
    id: "acme:metrics", label: "Metrics", icon: "x", component: () => null, providesHostMetrics: true,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("a status bar mounted hidden opens no metrics stream until shown", async () => {
  const { rerender } = render(bar(false));
  await act(async () => {});
  expect(metricsService.metricsStart).not.toHaveBeenCalled();

  rerender(bar(true));
  await waitFor(() => expect(metricsService.metricsStart).toHaveBeenCalledTimes(1));
});

test("hiding stops the stream and keeps the last reading; showing restarts it at once", async () => {
  const { rerender } = render(bar(true));
  await waitFor(() => expect(snapshotCb).not.toBeNull());
  act(() => snapshotCb!(snapshot(12)));
  expect(screen.getByText("cpu 12")).toBeTruthy();

  rerender(bar(false));
  await waitFor(() => expect(metricsService.metricsStop).toHaveBeenCalledWith("stream-1"));
  expect(unlistens[0]).toHaveBeenCalled();
  expect(screen.getByText("cpu 12")).toBeTruthy();

  snapshotCb = null;
  rerender(bar(true));
  await waitFor(() => expect(metricsService.metricsStart).toHaveBeenCalledTimes(2));
  expect(screen.getByText("cpu 12")).toBeTruthy();
  await waitFor(() => expect(snapshotCb).not.toBeNull());
  act(() => snapshotCb!(snapshot(40)));
  expect(screen.getByText("cpu 40")).toBeTruthy();
});

test("the high-CPU pulse animates only while the bar is visible", async () => {
  const { rerender } = render(bar(true));
  await waitFor(() => expect(snapshotCb).not.toBeNull());
  act(() => snapshotCb!(snapshot(95)));
  expect(screen.getByText("cpu 95").className).toContain("cpu-alert-pulse");

  rerender(bar(false));
  expect(screen.getByText("cpu 95").className).not.toContain("cpu-alert-pulse");

  rerender(bar(true));
  expect(screen.getByText("cpu 95").className).toContain("cpu-alert-pulse");
});
