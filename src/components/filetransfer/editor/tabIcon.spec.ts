import { describe, it, expect } from "vitest";
import { looksLikeImage, tabIcon } from "./tabIcon";
import type { EditorDoc, DiffDoc } from "@/stores/editorStore";

const file = (path: string): EditorDoc => ({
  id: "x", kind: "file", sftpId: null, path, hostLabel: "h", dirty: false, autoSave: false,
});
const diff: DiffDoc = {
  id: "d", kind: "diff",
  left: { sftpId: null, path: "/a", hostLabel: "h" },
  right: { sftpId: null, path: "/b", hostLabel: "h" },
  dirty: false,
};

describe("tabIcon", () => {
  it("maps by family", () => {
    expect(tabIcon(file("/x/main.go"))).toBe("lucide:file-code");
    expect(tabIcon(file("/x/Cargo.toml"))).toBe("lucide:file-cog");
    expect(tabIcon(file("/x/readme.md"))).toBe("lucide:file-text");
    expect(tabIcon(file("/x/blob.bin"))).toBe("lucide:file");
    expect(tabIcon(file("/x/noext"))).toBe("lucide:file");
  });
  it("uses git-compare for diff tabs", () => {
    expect(tabIcon(diff)).toBe("lucide:git-compare");
  });
});

describe("images", () => {
  it("shows the image icon only once the bytes said image", () => {
    expect(tabIcon(file("/x/cpu.png"))).toBe("lucide:file");
    expect(tabIcon({ ...file("/x/deploy-diagram"), image: true })).toBe("lucide:image");
  });
  it("guesses from the name only to choose the first read", () => {
    expect(looksLikeImage("/x/Shot.PNG")).toBe(true);
    expect(looksLikeImage("/x/logo.svg")).toBe(true);
    expect(looksLikeImage("/x/notes.txt")).toBe(false);
    expect(looksLikeImage("/x/.png")).toBe(false);
  });
});
