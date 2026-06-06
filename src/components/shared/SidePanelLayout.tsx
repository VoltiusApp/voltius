interface Props {
  /** Toolbar + scrollable content */
  children: React.ReactNode;
  /** Form / edit panel rendered on the right */
  panel: React.ReactNode;
  panelOpen: boolean;
  /** Width of the open panel in pixels (default 320) */
  panelWidth?: number;
  /** Background class for the outer wrapper (default bg-[var(--t-bg-base)]) */
  className?: string;
}

/**
 * Standard two-column layout used by HomePage, KeychainPage and SnippetsPage.
 *
 * The animated side panel slides in/out on the right. Click-outside-to-close
 * is handled at the scrollable content level by each page — BaseCard and
 * FolderCard call e.stopPropagation() so card clicks never bubble there.
 */
export function SidePanelLayout({
  children,
  panel,
  panelOpen,
  panelWidth = 320,
  className = "bg-(--t-bg-base)",
}: Props) {
  return (
    <div className={`flex h-full ${className}`}>
      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0">
        {children}
      </div>

      {/* Animated side panel */}
      <div
        className="shrink-0 overflow-hidden transition-all duration-200 ease-out relative z-10"
        style={{ width: panelOpen ? panelWidth : 0, opacity: panelOpen ? 1 : 0 }}
      >
        {panel}
      </div>
    </div>
  );
}
