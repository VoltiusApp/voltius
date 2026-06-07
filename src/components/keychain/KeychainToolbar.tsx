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

  return (
    <>
      <div ref={rowRef} className="flex items-center gap-2 px-5 py-2.5 shrink-0 chrome-toolbar">
        <div ref={leftRef} className="flex items-center">
          <ToolbarViewControls
            search={search}
            onSearchChange={onSearchChange}
            filterPlaceholder="Filter..."
            filterShortcutId="filter"
            filterWidth={176}
            layoutMode={layoutMode}
            onLayoutModeChange={onLayoutModeChange}
            sortMode={sortMode}
            onSortModeChange={onSortModeChange}
            availableTags={availableTags}
            tagFilter={tagFilter}
            onTagFilterChange={onTagFilterChange}
          />
        </div>

        <div ref={rightRef} className="ml-auto flex items-center gap-px shrink-0">
          <button
            onClick={onImportKey}
            onMouseDown={rippleKey}
            disabled={!onImportKey}
            title={compact ? "New Key" : undefined}
            className="flex items-center gap-2 px-3 h-8 text-sm font-bold tracking-wider transition-colors shrink-0 whitespace-nowrap relative overflow-hidden rounded-tl-[0.533rem] rounded-bl-[0.533rem]"
            style={{ background: "var(--t-accent)", color: "var(--t-bg-terminal)", opacity: !onImportKey ? 0.4 : 1, cursor: !onImportKey ? "default" : undefined }}
            onMouseEnter={(e) => { if (onImportKey) e.currentTarget.style.background = "var(--t-accent-hover)"; }}
            onMouseLeave={(e) => (e.currentTarget.style.background = "var(--t-accent)")}
            type="button"
          >
            {ripplesKey}
            <Icon icon="lucide:key-round" width={18} />
            {!compact && "New Key"}
          </button>
          <NewKeyChevron onImport={onImportKey} onGenerate={onGenerateKey} onNewIdentity={onNewIdentity} onNewFolder={onNewFolder} accent />
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────
// Split chevron for "NEW KEY" button
// ─────────────────────────────────────────────────────────────────

function NewKeyChevron({ onGenerate, onNewIdentity, onNewFolder, accent }: { onImport?: () => void; onGenerate?: () => void; onNewIdentity?: () => void; onNewFolder: () => void; accent?: boolean }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { createRipple, rippleEls } = useRipple();

  const handleClick = () => {
    if (!open && wrapperRef.current) {
      const r = wrapperRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
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
        className="flex items-center justify-center w-8 h-8 transition-colors relative overflow-hidden rounded-tr-[0.533rem] rounded-br-[0.533rem]"
        style={{ background: accent ? "var(--t-accent)" : "var(--t-bg-input)" }}
        onMouseEnter={(e) => (e.currentTarget.style.background = accent ? "var(--t-accent-hover)" : "var(--t-bg-input-hover)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = accent ? "var(--t-accent)" : "var(--t-bg-input)")}
        type="button"
        aria-label="New key options"
      >
        {rippleEls}
        <span className="[&_path]:stroke-3">
          <Icon icon="lucide:chevron-down" width={20} color="var(--t-bg-terminal)" style={{ transition: "transform 150ms", transform: open ? "rotate(180deg)" : "rotate(0deg)" }} />
        </span>
      </button>

      {open && (
        <div
          className="p-1.5 rounded-xl fixed z-9999 bg-(--t-bg-card) border border-(--t-bg-card-hover)"
          style={{
            top: pos.top,
            right: pos.right,
            width: "max-content",
            boxShadow: "var(--t-elev-2)",
          }}
        >
          {onGenerate && <DropdownMenuItem icon="lucide:key-round" label="Generate Key Pair" onClick={() => { setOpen(false); onGenerate(); }} />}
          {onNewIdentity && <DropdownMenuItem icon="lucide:user-plus" label="New Identity" onClick={() => { setOpen(false); onNewIdentity(); }} />}
          <DropdownMenuItem icon="lucide:folder-plus" label="New Folder" onClick={() => { setOpen(false); onNewFolder(); }} />
        </div>
      )}
    </div>
  );
}

