// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { openFileForEdit } from "./FilePane";
import { useEditorStore } from "@/stores/editorStore";
import type { FileEntry } from "./SFTPTypes";

const remoteCtx = { isLocal: false, sftpId: "s1", hostLabel: "host", onEdit: undefined };
const file = (over: Partial<FileEntry> = {}): FileEntry => ({
  name: "a.txt", path: "/a.txt", size: 1, isDir: false, ...over,
});

describe("openFileForEdit", () => {
  beforeEach(() => useEditorStore.setState({ tabs: [], activeTabId: null }));

  it("opens a remote file in the editor", () => {
    expect(openFileForEdit(file(), remoteCtx)).toBe(true);
    const s = useEditorStore.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0].kind === "file" && s.tabs[0].path).toBe("/a.txt");
  });

  it("opens a local file with null sftpId", () => {
    expect(openFileForEdit(file(), { isLocal: true, sftpId: null, hostLabel: "Local Machine", onEdit: undefined })).toBe(true);
    const tab = useEditorStore.getState().tabs[0];
    expect(tab.kind === "file" && tab.sftpId).toBeNull();
  });

  it("does not open directories", () => {
    expect(openFileForEdit(file({ isDir: true }), remoteCtx)).toBe(false);
    expect(useEditorStore.getState().tabs).toHaveLength(0);
  });

  it("does not open a remote file when there is no sftpId", () => {
    expect(openFileForEdit(file(), { ...remoteCtx, sftpId: null })).toBe(false);
    expect(useEditorStore.getState().tabs).toHaveLength(0);
  });

  it("delegates to the onEdit override instead of opening directly", () => {
    const onEdit = vi.fn();
    expect(openFileForEdit(file(), { ...remoteCtx, onEdit })).toBe(true);
    expect(onEdit).toHaveBeenCalledWith("/a.txt");
    expect(useEditorStore.getState().tabs).toHaveLength(0);
  });
});
