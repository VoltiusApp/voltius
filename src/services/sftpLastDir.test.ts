// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";

const sftp = vi.hoisted(() => ({
  sftpCanonicalize: vi.fn(async () => "/home/u"),
  sftpIsDir: vi.fn(async (_id: string, _path: string) => true),
}));
vi.mock("@/services/sftp", () => sftp);

import { openingSftpDir, rememberSftpDir } from "./sftpLastDir";

afterEach(() => { localStorage.clear(); sftp.sftpIsDir.mockReset().mockResolvedValue(true); });

test("a host never browsed opens at home without a stat", async () => {
  expect(await openingSftpDir("s1", "c1")).toEqual({ home: "/home/u", cwd: "/home/u" });
  expect(sftp.sftpIsDir).not.toHaveBeenCalled();
});

test("reopens the folder last listed on the same host only", async () => {
  rememberSftpDir("c1", "/var/log");
  expect(await openingSftpDir("s1", "c1")).toEqual({ home: "/home/u", cwd: "/var/log" });
  expect(sftp.sftpIsDir).toHaveBeenCalledWith("s1", "/var/log");
  expect((await openingSftpDir("s2", "c2")).cwd).toBe("/home/u");
});

test("falls back to home when the remembered folder is gone or the stat fails", async () => {
  rememberSftpDir("c1", "/gone");
  sftp.sftpIsDir.mockResolvedValueOnce(false);
  expect((await openingSftpDir("s1", "c1")).cwd).toBe("/home/u");
  sftp.sftpIsDir.mockRejectedValueOnce(new Error("permission denied"));
  expect((await openingSftpDir("s1", "c1")).cwd).toBe("/home/u");
});

test("corrupt storage reads as nothing remembered", async () => {
  localStorage.setItem("voltius.sftp.last_dir", "{not json");
  expect((await openingSftpDir("s1", "c1")).cwd).toBe("/home/u");
  rememberSftpDir("c1", "/srv");
  expect((await openingSftpDir("s1", "c1")).cwd).toBe("/srv");
});
