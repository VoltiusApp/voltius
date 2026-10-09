import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { HostChoice, SidePhase } from "./SFTPTypes";

type PaneProps = { phase: SidePhase; onPick: (h: HostChoice) => void; onChangeHost: () => void };

const h = vi.hoisted(() => ({
  panes: {} as Record<string, PaneProps>,
  listeners: new Map<string, () => void>(),
  connectFileBackend: vi.fn(),
  sftpClose: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, cb: () => void) => {
    h.listeners.set(name, cb);
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

const remote = (id: string) => ({
  kind: "remote",
  connection: { id, name: id, host: `${id}.example`, port: 22, username: "u", connection_type: "ssh" },
}) as unknown as HostChoice;

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
