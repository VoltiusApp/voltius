import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { ToolbarViewControls } from "@/components/shared/ToolbarViewControls";
import type { LayoutMode, SortMode } from "@/components/shared/ToolbarViewControls";

export interface MembersToolbarProps {
  search: string;
  onSearchChange: (v: string) => void;
  layoutMode: LayoutMode;
  onLayoutModeChange: (v: LayoutMode) => void;
  sortMode: SortMode;
  onSortModeChange: (v: SortMode) => void;
  canInvite: boolean;
  showInvitePanel: boolean;
  onToggleInvite: () => void;
  pendingCount?: number;
  canManageRoles?: boolean;
  showRolesPanel?: boolean;
  onToggleRoles?: () => void;
  selectedCount: number;
  vaultTabs?: { id: string; name: string }[];
  primaryVaultId: string | null;
  onSelectVault: (id: string) => void;
}

export function MembersToolbar({
  search, onSearchChange,
  layoutMode, onLayoutModeChange,
  sortMode, onSortModeChange,
  canInvite, showInvitePanel, onToggleInvite,
  pendingCount,
  canManageRoles, showRolesPanel, onToggleRoles,
  selectedCount,
  vaultTabs, primaryVaultId, onSelectVault,
}: MembersToolbarProps) {
  const { t } = useTranslation();
  return (
    <div
      className="flex items-center gap-2 px-5 py-2.5 shrink-0"
      style={{ borderBottom: "1px solid var(--t-border)", background: "var(--t-bg-toolbar)" }}
    >
      <div className="flex items-center gap-2 min-w-0">
        {vaultTabs && vaultTabs.length > 1 && (
          <div className="flex items-center gap-1 shrink-0">
            {vaultTabs.map(({ id, name }) => (
              <button
                key={id}
                onClick={() => onSelectVault(id)}
                className="px-2.5 py-1 rounded-lg text-xs font-medium transition-colors"
                style={{
                  background: id === primaryVaultId ? "var(--t-accent)" : "var(--t-bg-elevated)",
                  color: id === primaryVaultId ? "#fff" : "var(--t-text-dim)",
                }}
              >
                {name}
              </button>
            ))}
          </div>
        )}

        <ToolbarViewControls
          search={search}
          onSearchChange={onSearchChange}
          filterPlaceholder={t("members.toolbar.filterPlaceholder")}
          filterShortcutId="filter"
          layoutMode={layoutMode}
          onLayoutModeChange={onLayoutModeChange}
          sortMode={sortMode}
          onSortModeChange={onSortModeChange}
          extraSortOptions={[{ value: "role-asc", label: t("members.toolbar.sortByRole"), icon: "lucide:shield" }]}
          filterWidth={176}
        />
      </div>

      <div className="ml-auto flex items-center gap-2 shrink-0">
        {selectedCount > 1 && (
          <span className="text-xs text-(--t-text-dim) shrink-0">
            {t("members.toolbar.selectedCount", { count: selectedCount })}
          </span>
        )}

        {canManageRoles && onToggleRoles && (
          <button
            onClick={onToggleRoles}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0"
            style={{
              background: showRolesPanel ? "color-mix(in srgb, var(--t-accent) 15%, transparent)" : "var(--t-bg-elevated)",
              color: showRolesPanel ? "var(--t-accent)" : "var(--t-text-primary)",
              border: `1px solid ${showRolesPanel ? "var(--t-accent)" : "var(--t-border)"}`,
            }}
          >
            <Icon icon="lucide:shield" width={13} />
            {t("members.roles")}
          </button>
        )}

        {canInvite && (
          <>
            <div className="w-px h-5 self-center bg-(--t-border-hover)" />
            <button
              onClick={onToggleInvite}
              className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0"
              style={{
                background: showInvitePanel ? "var(--t-accent-hover)" : "var(--t-accent)",
                color: "var(--t-on-accent, #fff)",
                border: "1px solid var(--t-accent-hover)",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-accent-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = showInvitePanel ? "var(--t-accent-hover)" : "var(--t-accent)")}
            >
              <Icon icon="lucide:user-plus" width={13} />
              {t("members.toolbar.inviteBtn")}
              {!!pendingCount && (
                <span
                  className="absolute -top-1.5 -right-1.5 flex items-center justify-center text-[9px] font-bold rounded-full min-w-[16px] h-4 px-0.5"
                  style={{ background: "var(--t-status-error)", color: "#fff" }}
                >
                  {pendingCount}
                </span>
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
