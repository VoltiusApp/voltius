import { describe, it, expect } from "vitest";
import { classifyPaste, isSelfOrDescendant } from "./pasteClassify";
import type { FileEntry } from "@/components/filetransfer/SFTPTypes";

const dir = (path: string): FileEntry => ({ path, name: path.split("/").pop()!, isDir: true } as FileEntry);
const file = (path: string): FileEntry => ({ path, name: path.split("/").pop()!, isDir: false } as FileEntry);
const local = (cwd: string) => ({ isLocal: true, sftpId: null, cwd });
const remote = (id: string, cwd: string) => ({ isLocal: false, sftpId: id, cwd });

describe("isSelfOrDescendant", () => {
  it("matches self and nested paths", () => {
    expect(isSelfOrDescendant("/a/b", "/a/b")).toBe(true);
    expect(isSelfOrDescendant("/a/b", "/a/b/c")).toBe(true);
    expect(isSelfOrDescendant("/a/b", "/a/bc")).toBe(false);
    expect(isSelfOrDescendant("/a/b", "/a")).toBe(false);
  });
});

describe("classifyPaste", () => {
  it("copy across folders/hosts is a plain copy", () => {
    expect(classifyPaste({ mode: "copy", items: [file("/a/x")], source: local("/a") }, local("/b"))).toBe("copy");
    expect(classifyPaste({ mode: "copy", items: [file("/a/x")], source: local("/a") }, remote("s1", "/b"))).toBe("copy");
  });
  it("cut within the same host+folder is a no-op", () => {
    expect(classifyPaste({ mode: "cut", items: [file("/a/x")], source: local("/a") }, local("/a"))).toBe("noop");
  });
  it("cut same host different folder is a same-host move", () => {
    expect(classifyPaste({ mode: "cut", items: [file("/a/x")], source: local("/a") }, local("/b"))).toBe("move-same");
  });
  it("cut across hosts is a cross-host move", () => {
    expect(classifyPaste({ mode: "cut", items: [file("/a/x")], source: remote("s1", "/a") }, local("/b"))).toBe("move-cross");
  });
  it("rejects pasting a directory into itself or a descendant on the same host", () => {
    expect(classifyPaste({ mode: "copy", items: [dir("/a/b")], source: local("/a") }, local("/a/b"))).toBe("reject");
    expect(classifyPaste({ mode: "cut", items: [dir("/a/b")], source: local("/a") }, local("/a/b/c"))).toBe("reject");
  });
});
