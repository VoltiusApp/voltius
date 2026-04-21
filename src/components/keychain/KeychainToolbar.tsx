import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { ToolbarViewControls, type LayoutMode, type SortMode } from "@/components/shared/ToolbarViewControls";
import { useToolbarResize } from "@/hooks/useToolbarResize";
import { DropdownMenuItem } from "@/components/shared/DropdownMenuItem";
import { useRipple } from "@/hooks/useRipple";

interface KeychainToolbarProps {
  search: string;
  onSearchChange: (v: string) => void;
  layoutMode: LayoutMode;
  onLayoutModeChange: (v: LayoutMode) => void;
  sortMode: SortMode;
  onSortModeChange: (v: SortMode) => void;
  onImportKey?: () => void;
  onGenerateKey?: () => void;
  onNewIdentity?: () => void;
  onNewFolder: () => void;
  availableTags?: string[];
  tagFilter?: string[];
  onTagFilterChange?: (tags: string[]) => void;
}

export function KeychainToolbar({
  search,
  onSearchChange,
  layoutMode,
  onLayoutModeChange,
  sortMode,
  onSortModeChange,
  onImportKey,
  onGenerateKey,
  onNewIdentity,
  onNewFolder,
  availableTags,
  tagFilter,
  onTagFilterChange,
}: KeychainToolbarProps) {
  const { compact, rowRef, leftRef, rightRef } = useToolbarResize();
  const { createRipple: rippleKey, rippleEls: ripplesKey } = useRipple();
  const { createRipple: rippleIdentity, rippleEls: ripplesIdentity } = useRipple();

  return (
    <>
      <div ref={rowRef} className="flex items-center gap-2 px-5 py-2.5 shrink-0 bg-[var(--t-bg-sidebar)] border-b border-b-[var(--t-bg-terminal)]">
        <div ref={leftRef} className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-px">
            <button
              onClick={onImportKey}
              onMouseDown={rippleKey}
              disabled={!onImportKey}
              title={compact ? "New Key" : undefined}
              className="flex items-center gap-2 px-3 h-8 text-sm font-bold tracking-wider transition-colors shrink-0 whitespace-nowrap bg-[var(--t-bg-input)] text-[var(--t-text-primary)] relative overflow-hidden rounded-tl-[0.533rem] rounded-bl-[0.533rem]"
              style={{ opacity: !onImportKey ? 0.35 : undefined, cursor: !onImportKey ? "default" : undefined }}
              onMouseEnter={(e) => { if (onImportKey) e.currentTarget.style.background = "var(--t-bg-input-hover)"; }}
              onMouseLeave={(e) => (e.currentTarget.style.background = "var(--t-bg-input)")}
              type="button"
            >
              {ripplesKey}
              <Icon icon="lucide:key-round" width={18} />
              {!compact && "NEW KEY"}
            </button>
            <NewKeyChevron onImport={onImportKey} onGenerate={onGenerateKey} onNewFolder={onNewFolder} />
          </div>

          <button
            onClick={onNewIdentity}
            onMouseDown={rippleIdentity}
            disabled={!onNewIdentity}
            title={compact ? "New Identity" : undefined}
            className="flex items-center gap-2 px-3 h-8 rounded-lg text-sm font-bold tracking-wider transition-colors shrink-0 whitespace-nowrap bg-[var(--t-bg-input)] text-[var(--t-text-primary)] border border-[var(--t-border-hover)] relative overflow-hidden"
            style={{ opacity: !onNewIdentity ? 0.35 : undefined, cursor: !onNewIdentity ? "default" : undefined }}
            onMouseEnter={(e) => { if (onNewIdentity) e.currentTarget.style.background = "var(--t-bg-input-hover)"; }}
            onMouseLeave={(e) => (e.currentTarget.style.background = "var(--t-bg-input)")}
            type="button"
          >
            {ripplesIdentity}
            <Icon icon="lucide:user-plus" width={18} />
            {!compact && "NEW IDENTITY"}
          </button>
        </div>

        <div ref={rightRef} className="ml-auto flex">
          <ToolbarViewControls
            search={search}
            onSearchChange={onSearchChange}
            filterPlaceholder="Filter..."
            layoutMode={layoutMode}
            onLayoutModeChange={onLayoutModeChange}
            sortMode={sortMode}
            onSortModeChange={onSortModeChange}
            availableTags={availableTags}
            tagFilter={tagFilter}
            onTagFilterChange={onTagFilterChange}
          />
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────
// Split chevron for "NEW KEY" button
// ─────────────────────────────────────────────────────────────────

function NewKeyChevron({ onGenerate, onNewFolder }: { onImport?: () => void; onGenerate?: () => void; onNewFolder: () => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { createRipple, rippleEls } = useRipple();

  const handleClick = () => {
    if (!open && wrapperRef.current) {
      const r = wrapperRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left });
    }
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={wrapperRef}>
      <button
        onClick={handleClick}
        onMouseDown={createRipple}
        className="flex items-center justify-center w-8 h-8 transition-colors bg-[var(--t-bg-input)] relative overflow-hidden rounded-tr-[0.533rem] rounded-br-[0.533rem]"
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-bg-input-hover)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "var(--t-bg-input)")}
        type="button"
        aria-label="New key options"
      >
        {rippleEls}
        <span className="[&_path]:[stroke-width:3]">
          <Icon icon="lucide:chevron-down" width={20} color="white" />
        </span>
      </button>

      {open && (
        <div
          className="p-1.5 rounded-xl fixed z-[9999] bg-[var(--t-bg-card)] border border-[var(--t-bg-card-hover)]"
          style={{
            top: pos.top,
            left: pos.left,
            width: "max-content",
            boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
          }}
        >
          {onGenerate && <DropdownMenuItem icon="lucide:key-round" label="Generate Key Pair" onClick={() => { setOpen(false); onGenerate(); }} />}
          <DropdownMenuItem icon="lucide:folder-plus" label="New Folder" onClick={() => { setOpen(false); onNewFolder(); }} />
        </div>
      )}
    </div>
  );
}

