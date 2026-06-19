import { useEditorStore } from "@/stores/editorStore";

export function EditorTabStrip() {
  const tabs = useEditorStore((s) => s.tabs);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);
  const closeTab = useEditorStore((s) => s.closeTab);

  if (tabs.length === 0) return null;

  return (
    <div
      className="flex items-center gap-1 px-2 text-xs shrink-0"
      style={{
        borderBottom: "1px solid var(--t-border)",
        background: "var(--t-bg-elevated)",
        minHeight: "32px",
      }}
    >
      <button
        className="px-2 py-1 rounded transition-colors"
        style={{
          fontWeight: activeTabId === null ? 600 : undefined,
          color: activeTabId === null ? "var(--t-text)" : "var(--t-text-dim)",
          background: activeTabId === null ? "var(--t-bg-card-hover)" : "transparent",
        }}
        onClick={() => setActiveTab(null)}
      >
        Files
      </button>
      {tabs.map((t) => {
        const label =
          t.kind === "file"
            ? (t.path.split("/").pop() ?? t.path) + (t.dirty ? " ●" : "")
            : `diff: ${t.left.path.split("/").pop() ?? t.left.path} ↔ ${t.right.path.split("/").pop() ?? t.right.path}`;
        const active = activeTabId === t.id;
        return (
          <span key={t.id} className="flex items-center gap-0.5">
            <button
              className="px-2 py-1 rounded transition-colors"
              style={{
                fontWeight: active ? 600 : undefined,
                color: active ? "var(--t-text)" : "var(--t-text-dim)",
                background: active ? "var(--t-bg-card-hover)" : "transparent",
                maxWidth: "180px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={label}
              onClick={() => setActiveTab(t.id)}
            >
              {label}
            </button>
            <button
              className="px-1 py-1 rounded transition-colors"
              style={{ color: "var(--t-text-dim)" }}
              title="Close"
              onClick={() => closeTab(t.id)}
            >
              ×
            </button>
          </span>
        );
      })}
    </div>
  );
}
