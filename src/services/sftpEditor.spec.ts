import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import { sftpReadFile, sftpWriteFile, DEFAULT_EDITOR_MAX_BYTES } from "./sftp";

describe("sftp editor bindings", () => {
  beforeEach(() => invoke.mockReset());

  it("reads a file with max_bytes", async () => {
    invoke.mockResolvedValue({ content: "hi", size: 2 });
    const f = await sftpReadFile("s1", "/a.txt", DEFAULT_EDITOR_MAX_BYTES);
    expect(f.content).toBe("hi");
    expect(invoke).toHaveBeenCalledWith("sftp_read_file", {
      sftpId: "s1",
      path: "/a.txt",
      maxBytes: DEFAULT_EDITOR_MAX_BYTES,
    });
  });

  it("writes a file", async () => {
    invoke.mockResolvedValue(undefined);
    await sftpWriteFile("s1", "/a.txt", "data");
    expect(invoke).toHaveBeenCalledWith("sftp_write_file", {
      sftpId: "s1",
      path: "/a.txt",
      content: "data",
    });
  });
});
