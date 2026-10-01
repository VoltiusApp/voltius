import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useConnectionStore } from "@/stores/connectionStore";
import { useFolderStore } from "@/stores/folderStore";
import { useHostPicker } from "@/hooks/useHostPicker";
import { ConnectionAvatar } from "./ConnectionAvatar";
import { ToolbarDropdown } from "./ToolbarDropdown";
import { wslListDistros } from "@/services/sftp";
import { chevronRotateStyle, getConnectionIcon, getConnectionIconColor } from "@/utils/icons";
import { AvatarTile } from "@/components/shared/AvatarTile";
import { SORT_MODE_ICONS, useFilterShortcut } from "./ToolbarViewControls";
import type { SortMode } from "./ToolbarViewControls";
import { useIsAndroid } from "@/utils/platform";
import type { Connection } from "@/types";
import { connectionDisplayName } from "@/utils/connectionDisplayName";
import { searchMatcher } from "@/utils/search";
import { hostPickerRowKey, type HostPickerRow } from "@/utils/hostPickerTree";

export type HostChoice =
  | { kind: "local"; wslDistro?: string }
  | { kind: "remote"; connection: Connection };

interface Props {
  onPick: (h: HostChoice) => void;
  selectedHostId?: string;
  onBack?: () => void;
  sshOnly?: boolean;
  vaultId?: string;
}

export function HostPickerPanel({ onPick, selectedHostId, onBack, sshOnly, vaultId }: Props) {
  const { t } = useTranslation();
  const loadConnections = useConnectionStore((s) => s.loadConnections);
  const loadFolders = useFolderStore((s) => s.loadFolders);
  useEffect(() => { void loadConnections(); void loadFolders(); }, [loadConnections, loadFolders]);

  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [wslDistros, setWslDistros] = useState<string[]>([]);
  useEffect(() => { wslListDistros().then(setWslDistros).catch(() => {}); }, []);
  // Android sandbox can't spawn a local shell — hide local/WSL host targets.
  const isAndroid = useIsAndroid();
  const searchRef = useRef<HTMLInputElement>(null);
  useFilterShortcut(searchRef);

  const { rows, vaults, vaultFilter, setVaultFilter, toggleFolder, hasHosts } = useHostPicker({ query: search, sortMode, sshOnly, vaultId });
  const matchesQuery = searchMatcher(search);

  return (
    <div className="flex flex-col h-full bg-(--t-bg-base)">
      {/* Back header — only in slide-over mode */}
      {onBack && (
        <div
          className="flex items-center gap-2 px-3 py-3 shrink-0 bg-(--t-bg-card) border-b border-b-(--t-bg-terminal)"
        >
          <button
            onClick={onBack}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors shrink-0 text-(--t-text-dim)"
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--t-bg-elevated)"; e.currentTarget.style.color = "var(--t-text-primary)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--t-text-dim)"; }}
          >
            <span className="[&_path]:stroke-3">
              <Icon icon="lucide:arrow-left" width={16} />
            </span>
          </button>
          <h2 className="text-sm font-semibold flex-1 text-(--t-text-primary)">{t("shared.hostPicker.selectHostTitle")}</h2>
        </div>
      )}

      {/* Toolbar */}
      <div
        className="flex items-center gap-2 px-3 py-2 shrink-0 bg-(--t-bg-toolbar) border-b border-b-(--t-bg-terminal)"
      >
        <div className="flex-1 relative">
          <Icon icon="lucide:filter" width={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-(--t-text-dim)" />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("shared.hostPicker.filterPlaceholder")}
            className="form-input w-full pl-8 pr-2 h-8 rounded-lg text-xs outline-hidden bg-(--t-bg-input) border border-(--t-border) text-(--t-text-primary)"
          />
        </div>

        {vaults.length > 1 && (
          <ToolbarDropdown
            icon="lucide:vault"
            label={vaults.find((v) => v.id === vaultFilter)?.name ?? t("shared.hostPicker.allVaults")}
            value={vaultFilter ?? ALL_VAULTS}
            menuWidth={200}
            options={[
              { value: ALL_VAULTS, label: t("shared.hostPicker.allVaults"), icon: "lucide:layers" },
              ...vaults.map((v) => ({ value: v.id, label: v.name, icon: "lucide:vault" })),
            ]}
            onChange={(v) => setVaultFilter(v === ALL_VAULTS ? null : v)}
          />
        )}

        <ToolbarDropdown
          icon={SORT_MODE_ICONS[sortMode]}
          value={sortMode}
          menuWidth={200}
          options={[
            { value: "name-asc",  label: t("shared.sort.nameAsc"), icon: "lucide:arrow-up-a-z" },
            { value: "name-desc", label: t("shared.sort.nameDesc"), icon: "lucide:arrow-down-a-z" },
            { value: "newest",    label: t("shared.sort.newest"), icon: "lucide:arrow-down-0-1" },
            { value: "oldest",    label: t("shared.sort.oldest"), icon: "lucide:arrow-up-0-1" },
          ]}
          onChange={setSortMode}
        />
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto py-1.5 px-2">
        {!isAndroid && (
          <HostRow
            avatar={
              <div
                className="rounded-lg flex items-center justify-center shrink-0 w-[1.867rem] h-[1.867rem] bg-(--t-bg-elevated) text-(--t-text-dim)"
              >
                <Icon icon="lucide:monitor" width={14} />
              </div>
            }
            name={t("shared.hostPicker.localMachineName")}
            sub={t("shared.pickers.thisComputer")}
            isSelected={false}
            onClick={() => onPick({ kind: "local" })}
          />
        )}

        {!isAndroid && wslDistros
          .filter((d) => matchesQuery(d))
          .map((d) => {
            const icon = getConnectionIcon(d.split(/[-_ ]/)[0]);
            return (
              <HostRow
                key={`wsl:${d}`}
                avatar={
                  <AvatarTile
                    base={getConnectionIconColor(d.split(/[-_ ]/)[0]) ?? "var(--t-bg-card-avatar)"}
                    icon={icon}
                    iconSize={14}
                    className="w-[1.867rem] h-[1.867rem] rounded-lg text-white"
                  />
                }
                name={d}
                sub={t("shared.hostPicker.wslSub")}
                isSelected={false}
                onClick={() => onPick({ kind: "local", wslDistro: d })}
              />
            );
          })}

        {!hasHosts && (
          <p className="px-3 py-4 text-xs text-center text-(--t-text-muted)">{t("shared.hostPicker.noHostsConfigured")}</p>
        )}
        {hasHosts && rows.length === 0 && (
          <p className="px-3 py-4 text-xs text-center text-(--t-text-muted)">{t("shared.hostPicker.noHostsMatch")}</p>
        )}

        {rows.map((row) => (
          <PickerTreeRow
            key={hostPickerRowKey(row)}
            row={row}
            selectedHostId={selectedHostId}
            onToggleFolder={toggleFolder}
            onPickHost={(c) => onPick({ kind: "remote", connection: c })}
          />
        ))}
      </div>
    </div>
  );
}

const ALL_VAULTS = "__all__";

function PickerTreeRow({ row, selectedHostId, onToggleFolder, onPickHost }: {
  row: HostPickerRow;
  selectedHostId?: string;
  onToggleFolder: (id: string) => void;
  onPickHost: (c: Connection) => void;
}) {
  if (row.kind === "vault") {
    return (
      <p data-host-picker-vault={row.id} className="px-2.5 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider truncate text-(--t-text-dim)">
        {row.name}
      </p>
    );
  }
  const indent = { paddingLeft: `${row.depth * 1.067}rem` };
  if (row.kind === "folder") {
    return (
      <div style={indent}>
        <button
          data-host-picker-folder={row.folder.id}
          aria-expanded={!row.collapsed}
          onClick={() => onToggleFolder(row.folder.id)}
          className="w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-colors text-left text-(--t-text-secondary) hover:bg-(--t-bg-elevated)"
        >
          <Icon icon="lucide:chevron-right" width={13} className="shrink-0 text-(--t-text-dim)" style={chevronRotateStyle(!row.collapsed, 90)} />
          <Icon icon="lucide:folder" width={14} className="shrink-0 text-(--t-text-dim)" />
          <span className="flex-1 min-w-0 text-xs font-medium truncate">{row.folder.name}</span>
          <span className="text-xs shrink-0 text-(--t-text-dim)">{row.count}</span>
        </button>
      </div>
    );
  }
  const c = row.connection;
  return (
    <div style={indent}>
      <HostRow
        avatar={<ConnectionAvatar connection={c} size={28} />}
        name={connectionDisplayName(c)}
        sub={`${c.username}@${c.host}:${c.port}`}
        isSelected={c.id === selectedHostId}
        onClick={() => onPickHost(c)}
      />
    </div>
  );
}

export function HostRow({ avatar, name, sub, isSelected, onClick }: {
  avatar: React.ReactNode;
  name: string;
  sub: string;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-colors text-left"
      style={{ background: isSelected ? "var(--t-bg-card-hover)" : "transparent" }}
      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "var(--t-bg-elevated)"; }}
      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
    >
      {avatar}
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate font-medium text-(--t-text-bright)">{name}</p>
        <p className="text-xs truncate text-(--t-text-secondary)">{sub}</p>
      </div>
      {isSelected && <Icon icon="lucide:check" width={14} className="text-(--t-accent) shrink-0" />}
    </button>
  );
}
