// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ handlers: new Map<string, (e: { payload: { readOnly: boolean } }) => void>() }));

vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, fn: (e: { payload: { readOnly: boolean } }) => void) => {
    h.handlers.set(name, fn);
    return () => h.handlers.delete(name);
  },
}));

import { useReadOnlyFlips } from "./deviceReadOnly";
import { useEditorStore, type EditorDoc } from "@/stores/editorStore";

const open = (sftpId: string, path: string, readOnly: boolean) =>
  useEditorStore.getState().openDoc({ sftpId, path, hostLabel: "PC", autoSave: true, readOnly });
const readOnlyOf = (id: string) => (useEditorStore.getState().tabs.find((t) => t.id === id) as EditorDoc).readOnly;

beforeEach(() => {
  useEditorStore.setState({ tabs: [], activeTabId: null });
  h.handlers.clear();
});

describe("editor read-only follows the device", () => {
  test("reopening a file takes the current read-only state both ways", () => {
    const id = open("s1", "/a.txt", false);
    expect(open("s1", "/a.txt", true)).toBe(id);
    expect(readOnlyOf(id)).toBe(true);
    open("s1", "/a.txt", false);
    expect(readOnlyOf(id)).toBe(false);
  });

  test("a read-only flip updates open tabs of that session both ways", async () => {
    const a = open("s1", "/a.txt", false);
    const other = open("s2", "/b.txt", false);
    renderHook(() => useReadOnlyFlips("s1", () => {}));
    await waitFor(() => expect(h.handlers.has("sftp-readonly-s1")).toBe(true));
    const flip = (readOnly: boolean) => h.handlers.get("sftp-readonly-s1")!({ payload: { readOnly } });
    flip(true);
    expect(readOnlyOf(a)).toBe(true);
    expect(readOnlyOf(other)).toBe(false);
    flip(false);
    expect(readOnlyOf(a)).toBe(false);
  });
});
