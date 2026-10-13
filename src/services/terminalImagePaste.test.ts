import { beforeEach, describe, expect, test, vi } from "vitest";
import type { RemoteFile } from "@/services/sftp";

const h = vi.hoisted(() => ({
  existing: new Set<string>(),
  listing: [] as RemoteFile[],
  calls: [] as string[],
  png: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) as Uint8Array | null,
  toggle: true,
  writeFails: false,
  pasted: [] as string[],
  toasts: [] as { message: string }[],
}));

vi.mock("@/services/sftp", () => ({
  sftpOpen: vi.fn(async () => "sftp-1"),
  sftpClose: vi.fn(async () => { h.calls.push("close"); }),
  sftpCanonicalize: vi.fn(async () => "/home/me"),
  sftpExists: vi.fn(async (_id: string, p: string) => h.existing.has(p)),
  sftpMkdir: vi.fn(async (_id: string, p: string) => { h.calls.push(`mkdir ${p}`); }),
  sftpSetAttrs: vi.fn(async (_id: string, c: { paths: string[]; clear: number }) => {
    h.calls.push(`chmod -${c.clear.toString(8)} ${c.paths.join(",")}`);
  }),
  sftpWriteBytes: vi.fn(async (_id: string, p: string, b: Uint8Array) => {
    if (h.writeFails) throw new Error("disk full");
    h.calls.push(`write ${p} ${b.length}`);
  }),
  sftpListDir: vi.fn(async () => h.listing),
  sftpDelete: vi.fn(async (_id: string, p: string) => { h.calls.push(`delete ${p}`); }),
}));
vi.mock("@/services/terminalPaste", () => ({
  pasteToSession: vi.fn(async (_id: string, text: string) => { h.pasted.push(text); return true; }),
}));
vi.mock("@/utils/clipboard", () => ({ readClipboardImagePng: vi.fn(async () => h.png) }));
vi.mock("@/stores/toggleSettingsStore", () => ({ getToggle: () => h.toggle }));
vi.mock("@/stores/notificationStore", () => ({
  useNotificationStore: { getState: () => ({ addToast: (t: { message: string }) => h.toasts.push(t) }) },
}));
vi.mock("@/i18n", () => ({ default: { t: (k: string, o?: { error?: string }) => `${k}:${o?.error ?? ""}` } }));
vi.mock("@/services/backendErrors", () => ({ describeError: (e: unknown) => String((e as Error).message) }));

import { pasteClipboardImage, pastedImageName, shellQuotePath, uploadPastedImage } from "./terminalImagePaste";

const NOW = new Date(2026, 9, 13, 9, 5, 7, 42);
const DIR = "/home/me/.cache/voltius/pastes";

function file(name: string, ageDays: number): RemoteFile {
  return {
    name, path: `${DIR}/${name}`, size: 1, is_dir: false, is_symlink: false, permissions: null,
    modified: Math.floor(NOW.getTime() / 1000) - ageDays * 86400,
  };
}

beforeEach(() => {
  h.existing = new Set(["/home/me/.cache"]);
  h.listing = [];
  h.calls = [];
  h.png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  h.toggle = true;
  h.writeFails = false;
  h.pasted = [];
  h.toasts = [];
});

describe("pastedImageName", () => {
  test("stamps local time down to the millisecond", () => {
    expect(pastedImageName(NOW)).toBe("voltius-paste-20261013-090507-042.png");
  });
});

describe("shellQuotePath", () => {
  test("leaves a plain path bare", () => {
    expect(shellQuotePath("/home/me/.cache/a-1.png")).toBe("/home/me/.cache/a-1.png");
  });
  test("single-quotes spaces and quotes", () => {
    expect(shellQuotePath("/home/my user/it's.png")).toBe(`'/home/my user/it'\\''s.png'`);
  });
});

describe("uploadPastedImage", () => {
  test("creates the missing folders, locks the last to its owner and writes the PNG", async () => {
    expect(await uploadPastedImage("s1", new Uint8Array(4), NOW)).toBe(`${DIR}/voltius-paste-20261013-090507-042.png`);
    expect(h.calls).toEqual([
      "mkdir /home/me/.cache/voltius",
      `mkdir ${DIR}`,
      `chmod -77 ${DIR}`,
      `write ${DIR}/voltius-paste-20261013-090507-042.png 4`,
      "close",
    ]);
  });

  test("prunes only its own pastes older than a week", async () => {
    h.listing = [file("voltius-paste-old.png", 8), file("voltius-paste-new.png", 1), file("notes.txt", 30)];
    await uploadPastedImage("s1", new Uint8Array(1), NOW);
    expect(h.calls.filter((c) => c.startsWith("delete"))).toEqual([`delete ${DIR}/voltius-paste-old.png`]);
  });

  test("closes the SFTP channel when the write fails", async () => {
    h.writeFails = true;
    await expect(uploadPastedImage("s1", new Uint8Array(1), NOW)).rejects.toThrow("disk full");
    expect(h.calls[h.calls.length - 1]).toBe("close");
  });
});

describe("pasteClipboardImage", () => {
  test("pastes the uploaded path", async () => {
    await pasteClipboardImage("s1");
    expect(h.pasted).toHaveLength(1);
    expect(h.pasted[0]).toMatch(/^\/home\/me\/\.cache\/voltius\/pastes\/voltius-paste-\d{8}-\d{6}-\d{3}\.png$/);
  });

  test("does nothing without an image", async () => {
    h.png = null;
    await pasteClipboardImage("s1");
    expect(h.calls).toEqual([]);
    expect(h.pasted).toEqual([]);
  });

  test("does nothing when the toggle is off", async () => {
    h.toggle = false;
    await pasteClipboardImage("s1");
    expect(h.calls).toEqual([]);
  });

  test("reports a failed upload instead of pasting", async () => {
    h.writeFails = true;
    await pasteClipboardImage("s1");
    expect(h.pasted).toEqual([]);
    expect(h.toasts.map((t) => t.message)).toEqual(["terminal.pasteImage.failed:disk full"]);
  });
});
