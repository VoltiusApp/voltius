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

  it("openDiff creates a diff tab", () => {
    const id = useEditorStore.getState().openDiff(
      { sftpId: "s1", path: "/a", hostLabel: "h1" },
      { sftpId: "s2", path: "/b", hostLabel: "h2" },
    );
    const tab = useEditorStore.getState().tabs.find((t) => t.id === id);
    expect(tab?.kind).toBe("diff");
  });
});
