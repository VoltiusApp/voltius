import { test, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { Connection } from "@/types";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
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
