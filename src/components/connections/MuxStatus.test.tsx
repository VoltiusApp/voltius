import { test, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const h = vi.hoisted(() => ({
  live: undefined as string | undefined,
  start: vi.fn(),
  remove: vi.fn(),
  apply: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, string>) => (o?.version ? `${k}:${o.version}` : k) }),
}));
vi.mock("@iconify/react", () => ({ Icon: ({ icon }: { icon: string }) => <i data-icon={icon} /> }));
vi.mock("@/services/tmuxOnConnect", () => ({
  liveSession: () => h.live,
  startTmuxInstall: h.start,
  applyTmuxStatus: h.apply,
}));
vi.mock("@/services/tmuxInstall", () => ({
  tmuxRemove: h.remove,
  useTmuxPinVersion: () => "3.5a",
}));
vi.mock("@/stores/connectionStore", () => ({
  useConnectionStore: (sel: (s: unknown) => unknown) => sel({ connections: [], teamConnections: {} }),
}));
vi.mock("@/stores/sessionStore", () => ({
  useSessionStore: (sel: (s: unknown) => unknown) => sel({}),
}));
vi.mock("@/utils/notifyError", () => ({ notifyError: vi.fn() }));
vi.mock("@/components/shared/ConfirmModal", () => ({
  ConfirmModal: ({ message, onConfirm }: { message: string; onConfirm: () => void }) => (
    <div>
      <p>{message}</p>
      <button onClick={onConfirm}>confirm</button>
    </div>
  ),
}));

import MuxStatus from "./MuxStatus";
import { useHostMuxStore, type HostMux } from "@/stores/hostMuxStore";

const host = (over: Partial<HostMux>): HostMux => ({ kind: "none", checkedAt: 1, ...over });

beforeEach(() => {
  h.live = "s1";
  h.start.mockReset();
  h.remove.mockReset();
  h.apply.mockReset();
  useHostMuxStore.setState({ hosts: {}, installing: {}, lastFailure: {} });
});
afterEach(cleanup);

const renderRow = (persistOn = true, connectionId: string | undefined = "c1") =>
  render(<MuxStatus connectionId={connectionId} persistOn={persistOn} />);
const setHost = (over: Partial<HostMux>) => useHostMuxStore.setState({ hosts: { c1: host(over) } });

test("renders nothing when persistence is off or the host is new", () => {
  expect(renderRow(false).container.innerHTML).toBe("");
  cleanup();
  expect(renderRow(true, undefined).container.innerHTML).toBe("");
});

test("never checked: a disabled install button explains why", () => {
  renderRow();
  const btn = screen.getByRole("button", { name: "connections.form.mux.install" });
  expect((btn as HTMLButtonElement).disabled).toBe(true);
  expect(btn.getAttribute("title")).toBe("connections.form.mux.connectFirst");
});

test.each([
  ["screen", undefined, "connections.form.mux.install"],
  ["none", undefined, "connections.form.mux.install"],
  ["tmux-old", "3.0a", "connections.form.mux.installPin:3.5a"],
] as const)("%s with a live session offers an enabled install", (kind, version, label) => {
  setHost({ kind, version });
  renderRow();
  const btn = screen.getByRole("button", { name: label }) as HTMLButtonElement;
  expect(btn.disabled).toBe(false);
  fireEvent.click(btn);
  expect(h.start).toHaveBeenCalledWith("s1", "c1", "");
});

test("without a live session the install button is disabled with the reason", () => {
  h.live = undefined;
  setHost({ kind: "screen" });
  renderRow();
  const btn = screen.getByRole("button", { name: "connections.form.mux.install" }) as HTMLButtonElement;
  expect(btn.disabled).toBe(true);
  expect(btn.getAttribute("title")).toBe("connections.form.mux.connectFirst");
});

test("installing shows progress and no button", () => {
  setHost({ kind: "screen" });
  useHostMuxStore.setState({ installing: { c1: { step: "upload", progress: 40, quiet: false } } });
  renderRow();
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("40");
  expect(screen.queryByRole("button")).toBeNull();
});

test("a quiet update also shows progress in the editor", () => {
  setHost({ kind: "tmux-cc", version: "3.4", voltius: { active: "3.4", versions: ["3.4"], inUse: {}, outdated: true } });
  useHostMuxStore.setState({ installing: { c1: { step: "download", progress: 5, quiet: true } } });
  renderRow();
  expect(screen.getByRole("progressbar")).toBeTruthy();
});

test("the Voltius copy offers Remove, which asks first and then removes", async () => {
  const status = { supported: true };
  h.remove.mockResolvedValue(status);
  setHost({ kind: "tmux-cc", version: "3.5a", voltius: { active: "3.5a", versions: ["3.5a"], inUse: {}, outdated: false } });
  renderRow();
  expect(screen.queryByText("connections.form.mux.installPin:3.5a")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "connections.form.mux.remove" }));
  expect(h.remove).not.toHaveBeenCalled();
  expect(screen.getByText("connections.form.mux.removeMessage")).toBeTruthy();
  fireEvent.click(screen.getByText("confirm"));
  await vi.waitFor(() => expect(h.apply).toHaveBeenCalledWith("c1", status));
  expect(h.remove).toHaveBeenCalledWith("s1");
});

test("an outdated Voltius copy offers the pinned install next to Remove", () => {
  setHost({ kind: "tmux-cc", version: "3.4", voltius: { active: "3.4", versions: ["3.4"], inUse: {}, outdated: true } });
  renderRow();
  expect(screen.getByRole("button", { name: "connections.form.mux.installPin:3.5a" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "connections.form.mux.remove" })).toBeTruthy();
});

test("a system tmux with control mode has no button", () => {
  setHost({ kind: "tmux-cc", version: "3.4" });
  renderRow();
  expect(screen.queryByRole("button")).toBeNull();
});

test("an unsupported host greys out install with the reason", () => {
  setHost({ kind: "unsupported" });
  renderRow();
  const btn = screen.getByRole("button", { name: "connections.form.mux.install" }) as HTMLButtonElement;
  expect(btn.disabled).toBe(true);
  expect(btn.getAttribute("title")).toBe("connections.form.mux.unsupported");
});

test("the last failure is shown with the notification wording", () => {
  setHost({ kind: "screen" });
  useHostMuxStore.setState({ lastFailure: { c1: "download" } });
  renderRow();
  expect(screen.getByText("notifications.tmux.failed.download")).toBeTruthy();
});
