import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { ToolbarDropdown } from "./ToolbarDropdown";
import { Pills } from "./Pills";
import { matchShortcut } from "@/stores/shortcutStore";
import { getTagColorStyle } from "@/utils/tagColors";
import { chevronRotateStyle } from "@/utils/icons";

/** Focus a search/filter input when the user presses the `filter` shortcut (Ctrl+F). */
export function useFilterShortcut(ref: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (matchShortcut("filter", e)) {
        e.preventDefault();
        ref.current?.focus();
        ref.current?.select();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [ref]);
}

export type LayoutMode = "grid" | "list";
export type SortMode = "name-asc" | "name-desc" | "newest" | "oldest" | "role-asc";

export const SORT_MODE_ICONS: Record<SortMode, string> = {
  "name-asc":  "lucide:arrow-up-a-z",
  "name-desc": "lucide:arrow-down-a-z",
  newest:      "lucide:arrow-down-0-1",
  oldest:      "lucide:arrow-up-0-1",
  "role-asc":  "lucide:shield",
};

export const LAYOUT_MODE_ICONS: Record<LayoutMode, string> = {
  grid: "lucide:layout-grid",
  list: "lucide:layout-list",
};

interface Props {
  search: string;
  onSearchChange: (v: string) => void;
  filterPlaceholder?: string;
  filterShortcutId?: string;
  layoutMode: LayoutMode;
  onLayoutModeChange: (v: LayoutMode) => void;
  sortMode: SortMode;
  onSortModeChange: (v: SortMode) => void;
  extraSortOptions?: { value: SortMode; label: string; icon: string }[];
  filterWidth?: number;
  availableTags?: string[];
  tagCounts?: Record<string, number>;
  tagFilter?: string[];
  onTagFilterChange?: (tags: string[]) => void;
  onRenameTag?: (oldName: string, newName: string) => Promise<void>;
  onDeleteTag?: (name: string) => Promise<void>;
}

export function FilterInput({
  value,
  onChange,
  placeholder,
  width = 144,
  shortcutId,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  width?: number;
  shortcutId?: string;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  useFilterShortcut(shortcutId ? inputRef : { current: null });

  return (
    <div className="relative">
      <Icon
        icon="lucide:filter"
        width={13}
        className="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none text-(--t-text-dim)"
      />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? t("common.placeholder.filter")}
        className="form-input pl-7 pr-3 h-8 rounded-lg text-xs outline-hidden bg-(--t-bg-input) border border-(--t-border-hover) text-(--t-text-primary) placeholder:text-(--t-text-dim)"
        style={{
          width: `${(width / 15).toFixed(3)}rem`,
          minWidth: "4rem",
        }}
      />
    </div>
  );
}

export function ToolbarViewControls({
  search,
  onSearchChange,
  filterPlaceholder,
  filterShortcutId,
  layoutMode,
  onLayoutModeChange,
  sortMode,
  onSortModeChange,
  extraSortOptions,
  filterWidth = 144,
  availableTags,
  tagCounts,
  tagFilter,
  onTagFilterChange,
  onRenameTag,
  onDeleteTag,
}: Props) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1.5">
      <FilterInput value={search} onChange={onSearchChange} placeholder={filterPlaceholder ?? t("common.placeholder.filter")} width={filterWidth} shortcutId={filterShortcutId} />

      <div className="flex items-center gap-1">
        <Pills
          options={[
            { value: "grid", label: t("common.viewMode.grid"), icon: "lucide:layout-grid" },
            { value: "list", label: t("common.viewMode.list"), icon: "lucide:layout-list" },
          ]}
          value={layoutMode}
          onChange={onLayoutModeChange}
        />
        {availableTags !== undefined && onTagFilterChange && (
          <TagFilterButton
            availableTags={availableTags}
            tagCounts={tagCounts}
            tagFilter={tagFilter ?? []}
            onTagFilterChange={onTagFilterChange}
            onRenameTag={onRenameTag}
            onDeleteTag={onDeleteTag}
          />
        )}
        <ToolbarDropdown
          icon={SORT_MODE_ICONS[sortMode] ?? "lucide:arrow-up-down"}
          value={sortMode}
          menuWidth={200}
          className="-ml-1"
          options={[
            ...(extraSortOptions ?? []),
            { value: "name-asc",  label: t("shared.sort.nameAsc"), icon: "lucide:arrow-up-a-z" },
            { value: "name-desc", label: t("shared.sort.nameDesc"), icon: "lucide:arrow-down-a-z" },
            { value: "newest",    label: t("shared.sort.newest"), icon: "lucide:arrow-down-0-1" },
            { value: "oldest",    label: t("shared.sort.oldest"), icon: "lucide:arrow-up-0-1" },
          ]}
          onChange={onSortModeChange}
        />
      </div>
    </div>
  );
}

// ─── Tag filter button ────────────────────────────────────────────────────────

function TagFilterButton({
  availableTags,
  tagCounts,
  tagFilter,
  onTagFilterChange,
  onRenameTag,
  onDeleteTag,
}: {
  availableTags: string[];
  tagCounts?: Record<string, number>;
  tagFilter: string[];
  onTagFilterChange: (tags: string[]) => void;
  onRenameTag?: (oldName: string, newName: string) => Promise<void>;
  onDeleteTag?: (name: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [tagSearch, setTagSearch] = useState("");
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [deletingTag, setDeletingTag] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setEditingTag(null);
        setTagSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (editingTag !== null) editInputRef.current?.focus();
  }, [editingTag]);

  useEffect(() => {
    if (open) setTimeout(() => searchInputRef.current?.focus(), 0);
  }, [open]);

  const isActive = tagFilter.length > 0;

  const filteredTags = tagSearch.trim()
    ? availableTags.filter((tag) => tag.toLowerCase().includes(tagSearch.toLowerCase()))
    : availableTags;

  const toggleTag = (tag: string) => {
    onTagFilterChange(
      tagFilter.includes(tag)
        ? tagFilter.filter((tagName) => tagName !== tag)
        : [...tagFilter, tag],
    );
  };

  const commitEdit = async () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== editingTag && onRenameTag && editingTag) {
      // Follow the rename in active filter
      if (tagFilter.includes(editingTag)) {
        onTagFilterChange(tagFilter.map((tag) => (tag === editingTag ? trimmed : tag)));
      }
      await onRenameTag(editingTag, trimmed).catch(() => {});
    }
    setEditingTag(null);
  };

  const confirmDelete = async () => {
    if (!deletingTag || !onDeleteTag) return;
    if (tagFilter.includes(deletingTag)) {
      onTagFilterChange(tagFilter.filter((tag) => tag !== deletingTag));
    }
    await onDeleteTag(deletingTag).catch(() => {});
    setDeletingTag(null);
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      {/* Trigger */}
      <button
        onClick={() => { setOpen((o) => !o); if (open) { setEditingTag(null); setTagSearch(""); } }}
        title={t("shared.tagFilter.filterByTag")}
        className="flex items-center gap-1 px-2 h-8 rounded-lg transition-colors"
        style={{ color: isActive ? "var(--t-accent)" : "var(--t-text-primary)" }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t-tab-active-text)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = isActive ? "var(--t-accent)" : "var(--t-text-primary)")}
      >
        <Icon icon="lucide:tag" width={20} />
        {tagFilter.length > 1 && (
          <span
            className="text-xs font-bold px-1 rounded-sm bg-(--t-accent) text-(--t-bg-terminal)"
            style={{ lineHeight: "16px" }}
          >
            {tagFilter.length}
          </span>
        )}
        <span className="[&_path]:stroke-3">
          <Icon
            icon="lucide:chevron-down"
            width={20}
            style={chevronRotateStyle(open)}
          />
        </span>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="surface-float absolute right-0 top-full mt-1 z-50 flex flex-col overflow-hidden w-[16rem]"
        >
          {availableTags.length === 0 ? (
            /* ── Empty state ── */
            <div
              className="flex flex-col items-center gap-3 px-6 py-6 text-center"
              style={{ background: "linear-gradient(135deg, var(--t-bg-elevated) 0%, var(--t-bg-card) 100%)" }}
            >
              <div
                className="flex items-center justify-center rounded-2xl w-[3.2rem] h-[3.2rem] text-(--t-text-dim) border border-(--t-border)"
                style={{ background: "linear-gradient(135deg, var(--t-bg-card) 0%, var(--t-bg-toolbar) 100%)" }}
              >
                <Icon icon="lucide:tag" width={22} />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-sm font-bold text-(--t-text-primary)">{t("shared.tagFilter.emptyTitle")}</span>
                <span className="text-xs leading-relaxed text-(--t-text-dim)" style={{ maxWidth: "12rem" }}>
                  {t("shared.tagFilter.emptyDescription")}
                </span>
              </div>
            </div>
          ) : (
            <>
              {/* ── Search bar ── */}
              <div
                className="flex items-center gap-2 px-3 py-2 border-b border-b-(--t-border)"
              >
                <Icon icon="lucide:search" width={14} className="text-(--t-text-dim) shrink-0" />
                <input
                  ref={searchInputRef}
                  value={tagSearch}
                  onChange={(e) => setTagSearch(e.target.value)}
                  placeholder={t("shared.tagFilter.searchPlaceholder")}
                  className="flex-1 bg-transparent text-xs outline-hidden text-(--t-text-primary)"
                  onKeyDown={(e) => e.key === "Escape" && (setTagSearch(""), setOpen(false))}
                />
                {tagSearch && (
                  <button onClick={() => setTagSearch("")} className="text-(--t-text-dim)">
                    <Icon icon="lucide:x" width={12} />
                  </button>
                )}
              </div>

              {/* ── Clear selection ── */}
              {isActive && (
                <div className="border-b border-b-(--t-border)">
                  <button
                    onClick={() => onTagFilterChange([])}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors text-left text-(--t-text-muted)"
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-bg-elevated)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <Icon icon="lucide:x" width={14} />
                    {t("shared.tagFilter.clearSelection", { count: tagFilter.length })}
                  </button>
                </div>
              )}

              {/* ── Tag list ── */}
              <div className="p-1.5 flex flex-col max-h-[240px] overflow-y-auto">
                {filteredTags.length === 0 ? (
                  <p className="px-3 py-3 text-xs text-center text-(--t-text-dim)">
                    {t("shared.tagFilter.noTagsMatch", { search: tagSearch })}
                  </p>
                ) : (
                  filteredTags.map((tag) => (
                    <TagRow
                      key={tag}
                      tag={tag}
                      count={tagCounts?.[tag]}
                      isSelected={tagFilter.includes(tag)}
                      isEditing={editingTag === tag}
                      editValue={editValue}
                      editInputRef={editingTag === tag ? editInputRef : undefined}
                      onSelect={() => toggleTag(tag)}
                      onStartEdit={() => { setEditingTag(tag); setEditValue(tag); }}
                      onEditChange={setEditValue}
                      onEditCommit={commitEdit}
                      onEditCancel={() => setEditingTag(null)}
                      onDelete={() => setDeletingTag(tag)}
                      canManage={!!(onRenameTag && onDeleteTag)}
                    />
                  ))
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Confirm delete modal (inside ref so outside-click doesn't close dropdown) ── */}
      {deletingTag && (
        <div
          className="fixed inset-0 z-9999 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.55)" }}
          onClick={() => setDeletingTag(null)}
        >
          <div
            className="flex flex-col gap-4 p-5 rounded-2xl bg-(--t-bg-modal) border border-(--t-border-hover) w-[21.333rem]"
            style={{ boxShadow: "var(--t-elev-3)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col gap-1.5">
              <p className="text-sm font-semibold text-(--t-text-primary)">
                {t("shared.tagFilter.deleteTagTitle", { tag: deletingTag })}
              </p>
              <p className="text-xs text-(--t-text-dim)">
                {t("shared.tagFilter.deleteTagBody", { count: tagCounts?.[deletingTag] ?? 0 })}
              </p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setDeletingTag(null)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-(--t-bg-elevated) text-(--t-text-primary) border border-(--t-border-hover)"
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-border-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "var(--t-bg-elevated)")}
              >
                {t("common.action.cancel")}
              </button>
              <button
                onClick={confirmDelete}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-[#3D1515] text-[#F87171] border border-[#5C2020]"
                onMouseEnter={(e) => (e.currentTarget.style.background = "#5C2020")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "#3D1515")}
              >
                {t("common.action.delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tag row ──────────────────────────────────────────────────────────────────

function TagRow({
  tag,
  count,
  isSelected,
  isEditing,
  editValue,
  editInputRef,
  onSelect,
  onStartEdit,
  onEditChange,
  onEditCommit,
  onEditCancel,
  onDelete,
  canManage,
}: {
  tag: string;
  count?: number;
  isSelected: boolean;
  isEditing: boolean;
  editValue: string;
  editInputRef?: React.RefObject<HTMLInputElement | null>;
  onSelect: () => void;
  onStartEdit: () => void;
  onEditChange: (v: string) => void;
  onEditCommit: () => void;
  onEditCancel: () => void;
  onDelete: () => void;
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="flex items-center gap-1 px-2 py-1.5 rounded-lg group/row transition-colors"
      style={{ background: hovered && !isEditing ? "var(--t-bg-elevated)" : "transparent" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {isEditing ? (
        /* ── Inline edit mode ── */
        <>
          <Icon icon="lucide:tag" width={14} className="text-(--t-accent) shrink-0" />
          <input
            ref={editInputRef as React.RefObject<HTMLInputElement>}
            value={editValue}
            onChange={(e) => onEditChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); onEditCommit(); }
              if (e.key === "Escape") { e.preventDefault(); onEditCancel(); }
            }}
            onBlur={onEditCommit}
            className="flex-1 text-xs bg-transparent outline-hidden border-b min-w-0 text-(--t-text-primary) border-b-(--t-accent)"
          />
          <button
            onMouseDown={(e) => { e.preventDefault(); onEditCommit(); }}
            title={t("common.action.save")}
            className="shrink-0 p-1 rounded-sm transition-colors text-(--t-accent)"
          >
            <Icon icon="lucide:check" width={13} />
          </button>
          <button
            onMouseDown={(e) => { e.preventDefault(); onEditCancel(); }}
            title={t("common.action.cancel")}
            className="shrink-0 p-1 rounded-sm transition-colors text-(--t-text-dim)"
          >
            <Icon icon="lucide:x" width={13} />
          </button>
        </>
      ) : (
        /* ── Normal mode ── */
        <>
          <button
            onClick={onSelect}
            className="flex items-center gap-2 flex-1 min-w-0 text-left"
          >
            <span
              className="w-3.5 h-3.5 rounded-sm shrink-0 border"
              style={getTagColorStyle(tag)}
            />
            <span
              className="text-xs truncate"
              style={{ color: isSelected ? "var(--t-accent)" : "var(--t-text-primary)" }}
            >
              {tag}
            </span>
            {count !== undefined && (
              <span className="text-xs ml-auto pl-2 shrink-0 text-(--t-text-dim)">
                {count}
              </span>
            )}
          </button>
          {isSelected && !hovered && (
            <Icon icon="lucide:check" width={13} className="text-(--t-accent) shrink-0" />
          )}
          {canManage && hovered && (
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                onClick={(e) => { e.stopPropagation(); onStartEdit(); }}
                title={t("shared.tagFilter.renameTagTitle")}
                className="p-1 rounded-sm transition-colors text-(--t-text-dim)"
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--t-bg-card)"; e.currentTarget.style.color = "var(--t-text-primary)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--t-text-dim)"; }}
              >
                <Icon icon="lucide:pencil" width={13} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                title={t("shared.tagFilter.deleteTagButtonTitle")}
                className="p-1 rounded-sm transition-colors text-(--t-text-dim)"
                onMouseEnter={(e) => { e.currentTarget.style.background = "#3D1515"; e.currentTarget.style.color = "#F87171"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--t-text-dim)"; }}
              >
                <Icon icon="lucide:trash-2" width={13} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
