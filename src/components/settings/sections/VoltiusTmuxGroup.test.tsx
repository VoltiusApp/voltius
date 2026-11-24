import { test, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const h = vi.hoisted(() => ({
  live: undefined as string | undefined,
  start: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      k === "settings.hosts.voltiusTmux.stillUsed" ? `still used by ${o?.count} sessions` : o?.pin ? `${k} ${o.pin}` : k,
  }),
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/services/tmuxOnConnect", () => ({
  liveSession: () => h.live,
  startTmuxInstall: h.start,
  applyTmuxStatus: vi.fn(),
}));
vi.mock("@/services/tmuxInstall", () => ({
  tmuxRemove: vi.fn(),
  useTmuxPinVersion: () => "3.5a",
}));
vi.mock("@/stores/connectionStore", () => ({
  useConnectionStore: (sel: (s: unknown) => unknown) =>
    sel({ connections: [{ id: "c1", name: "web-1" }], teamConnections: {} }),
}));
vi.mock("@/stores/sessionStore", () => ({
  useSessionStore: (sel: (s: unknown) => unknown) => sel({}),
}));
vi.mock("@/utils/notifyError", () => ({ notifyError: vi.fn() }));

import { VoltiusTmuxGroup } from "./VoltiusTmuxGroup";
import { useHostMuxStore, type HostMux } from "@/stores/hostMuxStore";

const voltius = (over: Partial<NonNullable<HostMux["voltius"]>>): HostMux => ({
  kind: "tmux-cc",
  checkedAt: 1,
  voltius: { active: "3.5a", versions: ["3.5a"], inUse: {}, outdated: false, ...over },
});
const setHost = (host: HostMux) => useHostMuxStore.setState({ hosts: { c1: host } });

beforeEach(() => {
  h.live = "s1";
  h.start.mockReset();
  useHostMuxStore.setState({ hosts: {}, installing: {}, lastFailure: {} });
});
afterEach(cleanup);

test("renders nothing when no host has a Voltius copy", () => {
  expect(render(<VoltiusTmuxGroup />).container.innerHTML).toBe("");
  cleanup();
  setHost({ kind: "tmux-cc", checkedAt: 1 });
  expect(render(<VoltiusTmuxGroup />).container.innerHTML).toBe("");
});

test("a host older than the pin offers Update now", () => {
  setHost(voltius({ active: "3.4", versions: ["3.4"], outdated: true }));
  render(<VoltiusTmuxGroup />);
  expect(screen.getByText("web-1")).toBeTruthy();
  fireEvent.click(screen.getByText("settings.hosts.voltiusTmux.updateNow"));
  expect(h.start).toHaveBeenCalledWith("s1", "c1", "web-1");
});

test("an old copy still in use is named and Remove is offered", () => {
  setHost(voltius({ versions: ["3.5a", "3.4"], inUse: { "3.4": 2 } }));
  render(<VoltiusTmuxGroup />);
  expect(screen.getByText(/still used by 2 sessions/)).toBeTruthy();
  expect(screen.getByText("connections.form.mux.remove")).toBeTruthy();
  expect(screen.queryByText("settings.hosts.voltiusTmux.updateNow")).toBeNull();
});

test("without a live session the button is disabled with a reason", () => {
  h.live = undefined;
  setHost(voltius({}));
  render(<VoltiusTmuxGroup />);
  const btn = screen.getByText("connections.form.mux.remove") as HTMLButtonElement;
  expect(btn.disabled).toBe(true);
  expect(btn.title).toBe("connections.form.mux.connectFirst");
});

test("while installing the button is disabled", () => {
  setHost(voltius({ outdated: true }));
  useHostMuxStore.setState({ installing: { c1: { step: "download", progress: 10, quiet: false } } });
  render(<VoltiusTmuxGroup />);
  expect((screen.getByText("settings.hosts.voltiusTmux.installing") as HTMLButtonElement).disabled).toBe(true);
});
