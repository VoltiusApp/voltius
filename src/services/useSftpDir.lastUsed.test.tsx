import { test, expect, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { Connection } from "@/types";

const closed = vi.hoisted(() => ({ handlers: new Map<string, (e: { payload: unknown }) => void>() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, cb: (e: { payload: unknown }) => void) => { closed.handlers.set(name, cb); return () => {}; }),
}));
vi.mock("@/services/deviceFiles", () => ({ connectDevice: vi.fn(async () => ({ sftpId: "sftp-dev", rttMs: 3, readOnly: false })) }));
vi.mock("@/services/sftpTarget", () => ({ connectFileBackend: vi.fn(async () => "sftp-1") }));
vi.mock("@/services/sftp", () => ({
  sftpClose: vi.fn(async () => {}),
  sftpCanonicalize: vi.fn(async () => "/home/u"),
  sftpListDir: vi.fn(async () => []),
  sftpMkdir: vi.fn(), sftpRename: vi.fn(), sftpDelete: vi.fn(), sftpTouch: vi.fn(),
}));

import { useSftpDir } from "./useSftpDir";
import { useConnectionStore } from "@/stores/connectionStore";

test("opening a host in the SFTP browser marks it as used", async () => {
  const setLastUsed = vi.fn(async () => {});
  useConnectionStore.setState({ setLastUsed });
  const conn = { id: "c1", host: "box", port: 22, username: "u" } as Connection;
  renderHook(() => useSftpDir(conn));
  await waitFor(() => expect(setLastUsed).toHaveBeenCalledWith("c1"));
});

test("device_target_uses_connectDevice", async () => {
  const { connectDevice } = await import("@/services/deviceFiles");
  const { connectFileBackend } = await import("@/services/sftpTarget");
  const device = { deviceId: "d1", deviceKey: "k", name: "Work PC", platform: "linux", state: "ready", route: "lan", lastSeen: null } as const;
  const { result } = renderHook(() => useSftpDir({ device }));
  await waitFor(() => expect(result.current.phase).toMatchObject({ tag: "connected", sftpId: "sftp-dev", readOnly: false }));
  expect(connectDevice).toHaveBeenCalledWith("d1", expect.any(String), undefined);
  expect(connectFileBackend).not.toHaveBeenCalledWith(expect.objectContaining({ id: "d1" }), expect.anything());
});

test("device_connect_read_only_reaches_the_controller", async () => {
  const { connectDevice } = await import("@/services/deviceFiles");
  vi.mocked(connectDevice).mockResolvedValueOnce({ sftpId: "sftp-ro", rttMs: 3, readOnly: true });
  const device = { deviceId: "d3", deviceKey: "k", name: "Work PC", platform: "linux", state: "ready", route: "lan", lastSeen: null } as const;
  const { result } = renderHook(() => useSftpDir({ device }));
  await waitFor(() => expect(result.current.phase.tag).toBe("connected"));
  expect(result.current.readOnly).toBe(true);
});

test("a read-only flip event updates the controller both ways", async () => {
  const { connectDevice } = await import("@/services/deviceFiles");
  vi.mocked(connectDevice).mockResolvedValueOnce({ sftpId: "sftp-flip", rttMs: 3, readOnly: false });
  const device = { deviceId: "d4", deviceKey: "k", name: "Work PC", platform: "linux", state: "ready", route: "lan", lastSeen: null } as const;
  const { result } = renderHook(() => useSftpDir({ device }));
  await waitFor(() => expect(closed.handlers.has("sftp-readonly-sftp-flip")).toBe(true));
  expect(result.current.readOnly).toBe(false);
  act(() => closed.handlers.get("sftp-readonly-sftp-flip")!({ payload: { readOnly: true } }));
  expect(result.current.readOnly).toBe(true);
  act(() => closed.handlers.get("sftp-readonly-sftp-flip")!({ payload: { readOnly: false } }));
  expect(result.current.readOnly).toBe(false);
});

test("a coded sftp-closed shows that code's message and stops retrying", async () => {
  const device = { deviceId: "d2", deviceKey: "k", name: "Work PC", platform: "linux", state: "ready", route: "lan", lastSeen: null } as const;
  const { result } = renderHook(() => useSftpDir({ device }));
  await waitFor(() => expect(result.current.phase.tag).toBe("connected"));
  await waitFor(() => expect(closed.handlers.has("sftp-closed-sftp-dev")).toBe(true));
  act(() => closed.handlers.get("sftp-closed-sftp-dev")!({ payload: { code: "device-file-access-off" } }));
  expect(result.current.phase).toMatchObject({ tag: "error", errorCode: "device-file-access-off", final: true });
});

test("a device connect sets read-only on that session's open editor tabs", async () => {
  const { connectTarget } = await import("./useSftpDir");
  const { connectDevice } = await import("@/services/deviceFiles");
  const { useEditorStore } = await import("@/stores/editorStore");
  const setSftpReadOnly = vi.spyOn(useEditorStore.getState(), "setSftpReadOnly");
  const device = { deviceId: "d5", deviceKey: "k", name: "Work PC", platform: "linux", state: "ready", route: "lan", lastSeen: null } as const;
  vi.mocked(connectDevice).mockResolvedValueOnce({ sftpId: "sftp-re", rttMs: 3, readOnly: true });
  await connectTarget({ device }, "c1", { relink: "sftp-re" });
  expect(setSftpReadOnly).toHaveBeenLastCalledWith("sftp-re", true);
  vi.mocked(connectDevice).mockResolvedValueOnce({ sftpId: "sftp-re", rttMs: 3, readOnly: false });
  await connectTarget({ device }, "c2", { relink: "sftp-re" });
  expect(setSftpReadOnly).toHaveBeenLastCalledWith("sftp-re", false);
});
