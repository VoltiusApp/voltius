import { useTranslation } from "react-i18next";
import { ToolbarViewControls, type LayoutMode, type SortMode } from "@/components/shared/ToolbarViewControls";
import { useToolbarResize } from "@/hooks/useToolbarResize";
import { DropdownMenuItem } from "@/components/shared/DropdownMenuItem";
import { useRipple } from "@/hooks/useRipple";
import { SplitMenuChevron } from "@/components/shared/SplitMenuChevron";
import { ToolbarButton } from "@/components/shared/ToolbarButton";

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
  newFolderBlocked?: string;
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
  newFolderBlocked,
  availableTags,
  tagFilter,
  onTagFilterChange,
}: KeychainToolbarProps) {
  const { t } = useTranslation();
  const { compact, rowRef, leftRef, rightRef } = useToolbarResize();
  const { createRipple: rippleKey, rippleEls: ripplesKey } = useRipple();

  return (
    <>
      <div ref={rowRef} className="flex items-center gap-2 px-5 py-2.5 shrink-0 chrome-toolbar">
        <div ref={leftRef} className="flex items-center">
          <ToolbarViewControls
            search={search}
            onSearchChange={onSearchChange}
            filterPlaceholder={t("keychain.toolbar.filterPlaceholder")}
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
          <ToolbarButton
            variant="accent"
            round="left"
            icon="lucide:key-round"
            iconSize={18}
            label={t("keychain.toolbar.newKey")}
            compact={compact}
            className="overflow-hidden"
            onClick={onImportKey}
            onPointerDown={rippleKey}
            disabled={!onImportKey}
          >
            {ripplesKey}
          </ToolbarButton>
          <SplitMenuChevron label={t("keychain.toolbar.newKeyOptionsAriaLabel")}>
            {(close) => (
              <>
                {onGenerateKey && <DropdownMenuItem icon="lucide:key-round" label={t("keychain.toolbar.generateKeyPair")} onClick={() => { close(); onGenerateKey(); }} />}
                {onNewIdentity && <DropdownMenuItem icon="lucide:user-plus" label={t("keychain.toolbar.newIdentity")} onClick={() => { close(); onNewIdentity(); }} />}
                <DropdownMenuItem icon="lucide:folder-plus" label={t("keychain.toolbar.newFolder")} disabled={!!newFolderBlocked} title={newFolderBlocked} onClick={() => { close(); onNewFolder(); }} />
              </>
            )}
          </SplitMenuChevron>
        </div>
      </div>
    </>
  );
}
