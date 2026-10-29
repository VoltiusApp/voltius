import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { HostChoice, SidePhase } from "./SFTPTypes";
import { BackendError } from "@/services/backendErrors";

type PaneProps = {
  phase: SidePhase; onPick: (h: HostChoice) => void; onChangeHost: () => void;
  onDropFiles: (files: unknown[], fromSide: "left" | "right" | "panel", target?: string) => void;
  onMoveWithin?: (files: unknown[], target: string) => void;
  onPaste?: (dest: { isLocal: boolean; sftpId: string | null; cwd: string }) => void;
};

const h = vi.hoisted(() => ({
  panes: {} as Record<string, PaneProps>,
  listeners: new Map<string, (payload?: unknown) => void>(),
  connectFileBackend: vi.fn(),
  connectDevice: vi.fn(),
  sftpClose: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, cb: (e: { payload: unknown }) => void) => {
    h.listeners.set(name, (payload = {}) => cb({ payload }));
    return Promise.resolve(() => { h.listeners.delete(name); });
  },
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));
vi.mock("@/lib/invoke", () => ({ invoke: vi.fn() }));
vi.mock("@/services/sftp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/sftp")>()),
  sftpClose: h.sftpClose,
  sftpCanonicalize: async () => "/home/u",
}));
vi.mock("@/services/sftpTarget", () => ({ connectFileBackend: h.connectFileBackend }));
vi.mock("@/services/deviceFiles", () => ({ connectDevice: h.connectDevice }));
vi.mock("@/services/knownHosts", () => ({ cancelKnownHostPrompt: async () => {} }));
vi.mock("./SidePane", () => ({
  SidePane: (p: PaneProps & { side: string }) => {
    h.panes[p.side] = p;
    return null;
  },
}));
vi.mock("./editor/EditorTabStrip", () => ({ EditorTabStrip: () => null }));
vi.mock("./editor/EditorDropOverlay", () => ({ EditorDropOverlay: () => null }));
vi.mock("./InternalDragGhost", () => ({ InternalDragGhost: () => null }));
vi.mock("./editor/TabDragGhost", () => ({ TabDragGhost: () => null }));

import SFTPPage from "./SFTPPage";
import { useFileClipboardStore } from "@/stores/fileClipboardStore";

const remote = (id: string) => ({
  kind: "remote",
  connection: { id, name: id, host: `${id}.example`, port: 22, username: "u", connection_type: "ssh" },
}) as unknown as HostChoice;

const device = {
  kind: "device",
  device: { deviceId: "d1", deviceKey: "k1", name: "Desktop-PC", platform: "linux", state: "ready", route: "tailscale", lastSeen: null },
} as HostChoice;

const left = () => h.panes.left;
const closedIds = () => h.sftpClose.mock.calls.map(([id]) => id);

async function connectThenLose() {
  h.connectFileBackend.mockResolvedValueOnce("s1");
  render(<SFTPPage />);
  await act(async () => { left().onPick(remote("c1")); });
  expect(left().phase).toMatchObject({ tag: "connected", sftpId: "s1" });
  await act(async () => { h.listeners.get("sftp-closed-s1")!(); });
  expect(left().phase).toMatchObject({ tag: "error", lostSftpId: "s1" });
}

const runRetry = () => act(() => vi.advanceTimersByTimeAsync(60_000));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  h.panes = {};
  h.listeners.clear();
  h.connectFileBackend.mockReset();
  h.connectDevice.mockReset();
  h.sftpClose.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

test("a lost session is relinked by the reconnect and never closed", async () => {
  await connectThenLose();
  h.connectFileBackend.mockResolvedValueOnce("s1");
  await runRetry();

  expect(h.connectFileBackend).toHaveBeenLastCalledWith(expect.objectContaining({ id: "c1" }), expect.any(String), true, "s1");
  expect(left().phase).toMatchObject({ tag: "connected", sftpId: "s1" });
  expect(closedIds()).not.toContain("s1");
});

test("a reconnect that lands on a fresh session closes the lost one", async () => {
  await connectThenLose();
  h.connectFileBackend.mockResolvedValueOnce("s2");
  await runRetry();

  expect(h.connectFileBackend).toHaveBeenLastCalledWith(expect.anything(), expect.any(String), true, "s1");
  expect(left().phase).toMatchObject({ tag: "connected", sftpId: "s2" });
  expect(closedIds()).toEqual(["s1"]);
});

test("a failed relink keeps the lost session for the next attempt", async () => {
  await connectThenLose();
  h.connectFileBackend.mockRejectedValueOnce(new Error("unreachable"));
  await runRetry();

  expect(left().phase).toMatchObject({ tag: "error", lostSftpId: "s1" });
  expect(closedIds()).not.toContain("s1");
});

test("picking another host closes the lost session", async () => {
  await connectThenLose();
  h.connectFileBackend.mockResolvedValueOnce("s3");
  await act(async () => { left().onPick(remote("c2")); });

  expect(h.connectFileBackend).toHaveBeenLastCalledWith(expect.objectContaining({ id: "c2" }), expect.any(String), true, undefined);
  expect(closedIds()).toEqual(["s1"]);
});

test("device_pick_connects_with_connectDevice", async () => {
  h.connectDevice.mockResolvedValueOnce({ sftpId: "s9", rttMs: 41 });
  render(<SFTPPage />);
  await act(async () => { left().onPick(device); });

  expect(h.connectDevice).toHaveBeenCalledWith("d1", expect.any(String), undefined);
  expect(h.connectFileBackend).not.toHaveBeenCalled();
  expect(left().phase).toMatchObject({ tag: "connected", sftpId: "s9", cwd: "/home/u", route: "tailscale", rttMs: 41 });
});

test("a lost device session is relinked by the reconnect", async () => {
  h.connectDevice.mockResolvedValueOnce({ sftpId: "s9", rttMs: 41 });
  render(<SFTPPage />);
  await act(async () => { left().onPick(device); });
  await act(async () => { h.listeners.get("sftp-closed-s9")!(); });
  h.connectDevice.mockResolvedValueOnce({ sftpId: "s9", rttMs: 12 });
  await runRetry();

  expect(h.connectDevice).toHaveBeenLastCalledWith("d1", expect.any(String), "s9");
  expect(left().phase).toMatchObject({ tag: "connected", sftpId: "s9", rttMs: 12 });
});

test("refused_device_connect_is_not_retried", async () => {
  h.connectDevice.mockRejectedValueOnce(new BackendError("device-access-denied", "denied"));
  render(<SFTPPage />);
  await act(async () => { left().onPick(device); });
  expect(left().phase).toMatchObject({ tag: "error", errorCode: "device-access-denied", final: true });
  await runRetry();

  expect(h.connectDevice).toHaveBeenCalledTimes(1);
});

test("a session closed with a refusal shows it and is not retried", async () => {
  h.connectDevice.mockResolvedValueOnce({ sftpId: "s9", rttMs: 41 });
  render(<SFTPPage />);
  await act(async () => { left().onPick(device); });
  await act(async () => { h.listeners.get("sftp-closed-s9")!({ code: "device-access-expired" }); });

  expect(left().phase).toMatchObject({ tag: "error", errorCode: "device-access-expired", final: true });
  expect(left().phase).not.toMatchObject({ message: "fileTransfer.page.connectionLost" });
  await runRetry();
  expect(h.connectDevice).toHaveBeenCalledTimes(1);
});

test("a read-only device refuses writes into it and follows the backend's flips", async () => {
  const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
  h.connectDevice.mockResolvedValueOnce({ sftpId: "sd", rttMs: 1, readOnly: true });
  h.connectFileBackend.mockResolvedValueOnce("s1");
  render(<SFTPPage />);
  await act(async () => { left().onPick(device); });
  await act(async () => { h.panes.right.onPick(remote("c1")); });
  const file = { name: "a.txt", path: "/a.txt", size: 1, isDir: false };
  await act(async () => { left().onDropFiles([file], "right"); });
  await act(async () => { left().onMoveWithin?.([file], "/x"); });
  useFileClipboardStore.setState({ clipboard: { items: [file], source: { isLocal: false, sftpId: "s1", cwd: "/" }, mode: "copy" } });
  await act(async () => { left().onPaste?.({ isLocal: false, sftpId: "sd", cwd: "/" }); });
  expect(alert).toHaveBeenCalledTimes(3);
  expect(alert).toHaveBeenCalledWith("fileTransfer.myDevices.readOnlyShare");
  await act(async () => { h.listeners.get("sftp-readonly-sd")!({ readOnly: false }); });
  expect(left().phase).toMatchObject({ tag: "connected", readOnly: false });
  alert.mockRestore();
});
