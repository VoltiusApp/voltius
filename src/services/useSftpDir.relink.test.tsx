import { test, expect, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { Connection } from "@/types";

const closed = vi.hoisted(() => ({ handlers: new Map<string, (e: { payload: unknown }) => void>() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, cb: (e: { payload: unknown }) => void) => { closed.handlers.set(name, cb); return () => {}; }),
}));
vi.mock("@/services/sftpTarget", () => ({
  connectFileBackend: vi.fn(async (_c: unknown, _id: string, _i?: boolean, relink?: string) => relink ?? "sftp-1"),
}));
vi.mock("@/services/sftp", () => ({
  sftpClose: vi.fn(async () => {}),
  sftpCanonicalize: vi.fn(async () => "/home/u"),
  sftpIsDir: vi.fn(async () => true),
  sftpListDir: vi.fn(async () => []),
  sftpMkdir: vi.fn(), sftpRename: vi.fn(), sftpDelete: vi.fn(), sftpTouch: vi.fn(),
}));

import { useSftpDir } from "./useSftpDir";
import { connectFileBackend } from "@/services/sftpTarget";
import { sftpClose } from "@/services/sftp";

test("a dropped connection reconnects into the same session id, so open editors keep saving", async () => {
  const conn = { id: "c-drop", host: "box", port: 22, username: "u" } as Connection;
  const { result } = renderHook(() => useSftpDir(conn));
  await waitFor(() => expect(result.current.sftpId).toBe("sftp-1"));
  await waitFor(() => expect(closed.handlers.has("sftp-closed-sftp-1")).toBe(true));

  act(() => closed.handlers.get("sftp-closed-sftp-1")!({ payload: null }));
  expect(result.current.phase.tag).toBe("error");
  act(() => result.current.reconnect());

  await waitFor(() => expect(result.current.phase).toMatchObject({ tag: "connected", sftpId: "sftp-1" }));
  expect(vi.mocked(connectFileBackend)).toHaveBeenLastCalledWith(conn, expect.any(String), undefined, "sftp-1");
  expect(vi.mocked(sftpClose)).not.toHaveBeenCalledWith("sftp-1");
});
