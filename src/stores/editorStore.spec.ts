import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "./editorStore";

const reset = () =>
  useEditorStore.setState({ tabs: [], activeTabId: null });

describe("editorStore", () => {
  beforeEach(reset);

  it("opens a doc and activates it", () => {
    const id = useEditorStore.getState().openDoc({
      sftpId: "s1", path: "/a.txt", hostLabel: "host", autoSave: false,
    });
    const s = useEditorStore.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.activeTabId).toBe(id);
  });

  it("dedupes by sftpId+path", () => {
    const a = useEditorStore.getState().openDoc({ sftpId: "s1", path: "/a", hostLabel: "h", autoSave: false });
    const b = useEditorStore.getState().openDoc({ sftpId: "s1", path: "/a", hostLabel: "h", autoSave: false });
    expect(a).toBe(b);
    expect(useEditorStore.getState().tabs).toHaveLength(1);
  });

  it("setDirty toggles the flag", () => {
    const id = useEditorStore.getState().openDoc({ sftpId: "s1", path: "/a", hostLabel: "h", autoSave: false });
    useEditorStore.getState().setDirty(id, true);
    const tab = useEditorStore.getState().tabs.find((t) => t.id === id);
    expect(tab && tab.kind === "file" && tab.dirty).toBe(true);
  });

  it("closeTab falls back active to Files when closing active", () => {
    const id = useEditorStore.getState().openDoc({ sftpId: "s1", path: "/a", hostLabel: "h", autoSave: false });
    useEditorStore.getState().closeTab(id);
    expect(useEditorStore.getState().tabs).toHaveLength(0);
    expect(useEditorStore.getState().activeTabId).toBeNull();
  });

  it("opens a local doc with null sftpId, distinct from a remote doc at same path", () => {
    const local = useEditorStore.getState().openDoc({ sftpId: null, path: "/a", hostLabel: "Local Machine", autoSave: false });
    const remote = useEditorStore.getState().openDoc({ sftpId: "s1", path: "/a", hostLabel: "h", autoSave: false });
    expect(local).not.toBe(remote);
    expect(useEditorStore.getState().tabs).toHaveLength(2);
  });

  it("dedupes local docs by null sftpId + path", () => {
    const a = useEditorStore.getState().openDoc({ sftpId: null, path: "/a", hostLabel: "Local Machine", autoSave: false });
    const b = useEditorStore.getState().openDoc({ sftpId: null, path: "/a", hostLabel: "Local Machine", autoSave: false });
    expect(a).toBe(b);
    expect(useEditorStore.getState().tabs).toHaveLength(1);
  });

  it("openDiff creates a diff tab that starts clean", () => {
    const id = useEditorStore.getState().openDiff(
      { sftpId: "s1", path: "/a", hostLabel: "h1" },
      { sftpId: "s2", path: "/b", hostLabel: "h2" },
    );
    const tab = useEditorStore.getState().tabs.find((t) => t.id === id);
    expect(tab?.kind).toBe("diff");
    expect(tab && tab.kind === "diff" && tab.dirty).toBe(false);
  });

  it("setDiffDirty toggles the diff dirty flag", () => {
    const id = useEditorStore.getState().openDiff(
      { sftpId: "s1", path: "/a", hostLabel: "h1" },
      { sftpId: "s2", path: "/b", hostLabel: "h2" },
    );
    useEditorStore.getState().setDiffDirty(id, true);
    const tab = useEditorStore.getState().tabs.find((t) => t.id === id);
    expect(tab && tab.kind === "diff" && tab.dirty).toBe(true);
  });

  it("openDiff dedupes an existing pair regardless of order", () => {
    const a = useEditorStore.getState().openDiff(
      { sftpId: null, path: "/a", hostLabel: "h" },
      { sftpId: "s1", path: "/b", hostLabel: "h" },
    );
    const b = useEditorStore.getState().openDiff(
      { sftpId: "s1", path: "/b", hostLabel: "h" },
      { sftpId: null, path: "/a", hostLabel: "h" },
    );
    expect(b).toBe(a);
    expect(useEditorStore.getState().tabs.filter((t) => t.kind === "diff")).toHaveLength(1);
    expect(useEditorStore.getState().activeTabId).toBe(a);
  });

  it("moveTab reorders tabs without changing the active tab", () => {
    const a = useEditorStore.getState().openDoc({ sftpId: null, path: "/a", hostLabel: "h", autoSave: false });
    const b = useEditorStore.getState().openDoc({ sftpId: null, path: "/b", hostLabel: "h", autoSave: false });
    const c = useEditorStore.getState().openDoc({ sftpId: null, path: "/c", hostLabel: "h", autoSave: false });
    useEditorStore.getState().setActiveTab(b);
    useEditorStore.getState().moveTab(a, 3); // move A to after C
    expect(useEditorStore.getState().tabs.map((t) => t.id)).toEqual([b, c, a]);
    expect(useEditorStore.getState().activeTabId).toBe(b);
  });
});
