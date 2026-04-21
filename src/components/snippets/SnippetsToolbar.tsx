import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { FilterInput, SORT_MODE_ICONS, type SortMode } from "@/components/shared/ToolbarViewControls";
import { ToolbarDropdown } from "@/components/shared/ToolbarDropdown";
import { DropdownMenuItem } from "@/components/shared/DropdownMenuItem";
import { useToolbarResize } from "@/hooks/useToolbarResize";
import { useRipple } from "@/hooks/useRipple";

interface Props {
  search: string;
  onSearchChange: (v: string) => void;
  sortMode: SortMode;
  onSortModeChange: (v: SortMode) => void;
  onNewSnippet: () => void;
  onNewFolder: () => void;
}

export function SnippetsToolbar({
  search,
  onSearchChange,
  sortMode,
  onSortModeChange,
  onNewSnippet,
  onNewFolder,
}: Props) {
  const { compact, rowRef, leftRef, rightRef } = useToolbarResize();
  const { createRipple, rippleEls } = useRipple();
  const { createRipple: rippleChevron, rippleEls: ripplesChevron } = useRipple();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const openMenu = () => {
    if (!menuOpen && wrapperRef.current) {
      const r = wrapperRef.current.getBoundingClientRect();
      setMenuPos({ top: r.bottom + 4, left: r.left });
    }
    setMenuOpen((o) => !o);
  };

  return (
    <>
      <div
        ref={rowRef}
        className="flex items-center gap-2 px-5 py-2.5 bg-[var(--t-bg-sidebar)] border-b border-b-[var(--t-bg-terminal)]"
      >
        <div ref={leftRef} className="flex items-center gap-2 shrink-0">
          <div className="relative flex items-center gap-px" ref={wrapperRef}>
            {/* Primary action */}
            <button
              onClick={onNewSnippet}
              onMouseDown={createRipple}
              title={compact ? "New Snippet" : undefined}
              type="button"
              className="flex items-center gap-2 px-3 h-8 text-sm font-bold tracking-wider transition-colors shrink-0 whitespace-nowrap bg-[var(--t-bg-input)] text-[var(--t-text-primary)] relative overflow-hidden rounded-tl-[0.533rem] rounded-bl-[0.533rem]"
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-bg-input-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "var(--t-bg-input)")}
            >
              {rippleEls}
              <Icon icon="lucide:braces" width={18} />
              {!compact && "NEW SNIPPET"}
            </button>

            {/* Chevron dropdown */}
            <button
              onClick={openMenu}
              onMouseDown={rippleChevron}
              type="button"
              aria-label="New snippet options"
              className="flex items-center justify-center w-8 h-8 transition-colors bg-[var(--t-bg-input)] relative overflow-hidden rounded-tr-[0.533rem] rounded-br-[0.533rem]"
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-bg-input-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "var(--t-bg-input)")}
            >
              {ripplesChevron}
              <span className="[&_path]:[stroke-width:3]">
                <Icon icon="lucide:chevron-down" width={20} color="white" />
              </span>
            </button>

            {menuOpen && (
              <div
                className="p-1.5 rounded-xl fixed z-[9999] bg-[var(--t-bg-card)] border border-[var(--t-bg-card-hover)]"
                style={{
                  top: menuPos.top,
                  left: menuPos.left,
                  width: "max-content",
                  boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
                }}
              >
                <DropdownMenuItem
                  icon="lucide:folder-plus"
                  label="New Folder"
                  onClick={() => { setMenuOpen(false); onNewFolder(); }}
                />
              </div>
            )}
          </div>
        </div>

        <div ref={rightRef} className="ml-auto flex items-center gap-1.5">
          <FilterInput
            value={search}
            onChange={onSearchChange}
            placeholder="Filter snippets..."
            width={176}
          />
          <ToolbarDropdown
            icon={SORT_MODE_ICONS[sortMode]}
            value={sortMode}
            menuWidth={200}
            options={[
              { value: "name-asc",  label: "A → Z",        icon: "lucide:arrow-up-a-z" },
              { value: "name-desc", label: "Z → A",        icon: "lucide:arrow-down-a-z" },
              { value: "newest",    label: "Newest first",  icon: "lucide:arrow-down-0-1" },
              { value: "oldest",    label: "Oldest first",  icon: "lucide:arrow-up-0-1" },
            ]}
            onChange={onSortModeChange}
          />
        </div>
      </div>
    </>
  );
}
