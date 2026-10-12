import { useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useConnectionStore } from "@/stores/connectionStore";
import { TagBadge } from "@/components/shared/TagBadge";
import { getTagColorStyle } from "@/utils/tagColors";
import { ChipInput } from "./ChipInput";
import { PickerSurface } from "./PickerSurface";
import { compareStrings } from "@/utils/localeFormat";
import { searchMatcher } from "@/utils/search";

interface Props {
  value: string[];
  onChange: (tags: string[]) => void;
  vaultId?: string;
}

export default function TagSelector({ value, onChange, vaultId }: Props) {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const connections = useConnectionStore((s) => s.connections);
  const allTags = useMemo(() => {
    const set = new Set<string>();
    const scoped = vaultId ? connections.filter((c) => c.vault_id === vaultId) : connections;
    for (const c of scoped) for (const tag of c.tags) set.add(tag);
    return [...set].sort(compareStrings);
  }, [connections, vaultId]);

  const query = input.trim().toLowerCase();
  const suggestions = useMemo(() => {
    const match = searchMatcher(query);
    return allTags.filter((tag) => !value.includes(tag) && match(tag));
  }, [allTags, value, query]);

  const canCreate = query.length > 0 && !value.includes(input.trim()) && !allTags.some((tag) => tag.toLowerCase() === query);

  const addTag = (tag: string) => {
    const tagName = tag.trim();
    if (!tagName || value.includes(tagName)) return;
    onChange([...value, tagName]);
    setInput("");
  };

  const removeTag = (tag: string) => onChange(value.filter((tagName) => tagName !== tag));

  const close = () => {
    setOpen(false);
    setInput("");
  };

  const showDropdown = open && (suggestions.length > 0 || canCreate);

  return (
    <div ref={containerRef}>
      <ChipInput
        value={value}
        input={input}
        onInputChange={(text) => {
          setInput(text);
          setOpen(true);
        }}
        onAdd={addTag}
        onRemove={removeTag}
        renderChip={(tag, children) => (
          <TagBadge key={tag} tag={tag} className="flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium">
            {children}
          </TagBadge>
        )}
        removeLabel={(tag) => t("shared.tagSelector.removeTag", { tag })}
        placeholder={t("shared.tagSelector.placeholder")}
        emptyIcon="lucide:tag"
        onFocus={() => setOpen(true)}
        onEscape={close}
      />

      <PickerSurface open={showDropdown} onClose={close} anchorRef={containerRef} title={t("common.entity.tags")}>
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
            <span className="text-(--t-text-dim)">{t("common.action.create")}</span>
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
      </PickerSurface>
    </div>
  );
}
