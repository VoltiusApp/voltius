import { panelTransition } from "@/components/shared/panelMotion";

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
  className = "chrome-canvas",
}: Props) {
  return (
    <div className={`flex h-full ${className}`}>
      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0">
        {children}
      </div>

      <div
        className="shrink-0 overflow-hidden relative z-10"
        style={{ width: panelOpen ? panelWidth : 0, transition: panelTransition(panelOpen, "width") }}
      >
        <div className="absolute inset-y-0 left-0" style={{ width: panelWidth, transition: panelTransition(panelOpen, "width") }}>
          {panel}
        </div>
      </div>
    </div>
  );
}
