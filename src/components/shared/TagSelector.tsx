import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@iconify/react";
import { useConnectionStore } from "@/stores/connectionStore";
import { TagBadge } from "@/components/shared/TagBadge";
import { getTagColorStyle } from "@/utils/tagColors";

interface Props {
  value: string[];
  onChange: (tags: string[]) => void;
  vaultId?: string;
}

export default function TagSelector({ value, onChange, vaultId }: Props) {
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const connections = useConnectionStore((s) => s.connections);
  const allTags = useMemo(() => {
    const set = new Set<string>();
    const scoped = vaultId ? connections.filter((c) => c.vault_id === vaultId) : connections;
    for (const c of scoped) for (const t of c.tags) set.add(t);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [connections, vaultId]);

  const query = input.trim().toLowerCase();
  const suggestions = useMemo(() => {
    return allTags.filter(
      (t) => !value.includes(t) && (!query || t.toLowerCase().includes(query)),
    );
  }, [allTags, value, query]);

  const canCreate = query.length > 0 && !value.includes(input.trim()) && !allTags.some((t) => t.toLowerCase() === query);

  const updatePos = () => {
    if (containerRef.current) {
      const r = containerRef.current.getBoundingClientRect();
      setDropdownPos({ top: r.bottom + 4, left: r.left, width: r.width });
    }
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!containerRef.current?.contains(target) && !dropdownRef.current?.contains(target)) {
        setOpen(false);
        setInput("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = () => updatePos();
    window.addEventListener("resize", handler);
    window.addEventListener("scroll", handler, true);
    return () => { window.removeEventListener("resize", handler); window.removeEventListener("scroll", handler, true); };
  }, [open]);

  const addTag = (tag: string) => {
    const t = tag.trim();
    if (!t || value.includes(t)) return;
    onChange([...value, t]);
    setInput("");
  };

  const removeTag = (tag: string) => onChange(value.filter((t) => t !== tag));

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "Enter" || e.key === ",") && input.trim()) {
      e.preventDefault();
      addTag(input.trim().replace(/,$/, ""));
    } else if (e.key === "Backspace" && !input && value.length > 0) {
      onChange(value.slice(0, -1));
    } else if (e.key === "Escape") {
      setOpen(false);
      setInput("");
    }
  };

  const handleFocus = () => {
    updatePos();
    setOpen(true);
  };

  const showDropdown = open && (suggestions.length > 0 || canCreate);

  return (
    <div ref={containerRef}>
      <div
        className="flex flex-wrap items-center gap-1.5 px-2.5 py-2 rounded-lg cursor-text min-h-[38px]"
        style={{
          background: "var(--t-bg-base)",
          border: "1px solid var(--t-border)",
          transition: "border-color 150ms",
        }}
        onFocus={() => {}}
        onClick={() => inputRef.current?.focus()}
        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--t-border-hover)"; }}
        onMouseLeave={(e) => {
          if (document.activeElement !== inputRef.current) {
            (e.currentTarget as HTMLDivElement).style.borderColor = "var(--t-border)";
          }
        }}
      >
        {value.map((tag) => (
          <TagBadge key={tag} tag={tag} className="flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium">
            {tag}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removeTag(tag); }}
              className="opacity-60 hover:opacity-100 transition-opacity leading-none"
              aria-label={`Remove tag ${tag}`}
            >
              <Icon icon="lucide:x" width={9} />
            </button>
          </TagBadge>
        ))}
        <div className="flex items-center gap-1 flex-1 min-w-[80px]">
          {value.length === 0 && !input && (
            <Icon icon="lucide:tag" width={12} className="text-(--t-text-dim) shrink-0" />
          )}
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => { setInput(e.target.value); if (!open) { updatePos(); setOpen(true); } }}
            onFocus={handleFocus}
            onBlur={(e) => {
              if (!dropdownRef.current?.contains(e.relatedTarget as Node)) {
                (containerRef.current as HTMLDivElement | null)?.style && ((containerRef.current as HTMLDivElement).style.borderColor = "var(--t-border)");
              }
            }}
            onKeyDown={handleKeyDown}
            placeholder={value.length === 0 ? "Add tags…" : ""}
            className="flex-1 bg-transparent outline-hidden text-xs text-(--t-text-primary) placeholder:text-(--t-text-dim) min-w-0"
          />
        </div>
      </div>

      {showDropdown && createPortal(
        <div
          ref={dropdownRef}
          className="surface-float fixed z-9999 p-1.5 flex flex-col max-h-[220px] overflow-y-auto"
          style={{
            top: dropdownPos.top,
            left: dropdownPos.left,
            width: dropdownPos.width,
          }}
        >
          {canCreate && (
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); addTag(input.trim()); }}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-colors"
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-card-hover)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
            >
              <span
                className="w-4 h-4 rounded-sm flex items-center justify-center shrink-0"
                style={getTagColorStyle(input.trim())}
              >
                <Icon icon="lucide:plus" width={9} />
              </span>
              <span className="text-(--t-text-dim)">Create</span>
              <span
                className="px-1.5 py-0.5 rounded-sm text-[11px] font-medium border"
                style={getTagColorStyle(input.trim())}
              >
                {input.trim()}
              </span>
            </button>
          )}

          {canCreate && suggestions.length > 0 && (
            <div className="my-1 border-t border-t-(--t-bg-card-hover)" />
          )}

          {suggestions.map((tag) => (
            <button
              key={tag}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); addTag(tag); }}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-colors"
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-card-hover)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
            >
              <span
                className="w-4 h-4 rounded-sm shrink-0 border"
                style={getTagColorStyle(tag)}
              />
              <span className="flex-1 text-left text-(--t-text-primary)">{tag}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
