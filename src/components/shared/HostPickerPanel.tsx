import { useEffect, useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { useConnectionStore } from "@/stores/connectionStore";
import { useUIStore } from "@/stores/uiStore";
import { matchesSearch, compareConnections } from "@/utils/connectionFilter";
import { ConnectionAvatar } from "./ConnectionAvatar";
import { ToolbarDropdown } from "./ToolbarDropdown";
import { SORT_MODE_ICONS } from "./ToolbarViewControls";
import type { SortMode } from "./ToolbarViewControls";
import type { Connection } from "@/types";

export type HostChoice =
  | { kind: "local" }
  | { kind: "remote"; connection: Connection };

interface Props {
  onPick: (h: HostChoice) => void;
  selectedHostId?: string;
  onBack?: () => void;
  sshOnly?: boolean;
}

export function HostPickerPanel({ onPick, selectedHostId, onBack, sshOnly }: Props) {
  const { connections, loadConnections } = useConnectionStore();
  useEffect(() => { void loadConnections(); }, [loadConnections]);

  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const setActiveNav = useUIStore((s) => s.setActiveNav);
  const setHomePendingAction = useUIStore((s) => s.setHomePendingAction);

  const filtered = useMemo(
    () => connections
      .filter((c) => !sshOnly || c.connection_type !== "serial")
      .filter((c) => matchesSearch(c, search))
      .sort((a, b) => compareConnections(a, b, sortMode)),
    [connections, search, sortMode, sshOnly],
  );

  return (
    <div className="flex flex-col h-full bg-[var(--t-bg-base)]">
      {/* Back header — only in slide-over mode */}
      {onBack && (
        <div
          className="flex items-center gap-2 px-3 py-3 shrink-0 bg-[var(--t-bg-card)] border-b border-b-[var(--t-bg-terminal)]"
        >
          <button
            onClick={onBack}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors shrink-0 text-[var(--t-text-dim)]"
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--t-bg-elevated)"; e.currentTarget.style.color = "var(--t-text-primary)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--t-text-dim)"; }}
          >
            <span className="[&_path]:[stroke-width:3]">
              <Icon icon="lucide:arrow-left" width={16} />
            </span>
          </button>
          <h2 className="text-sm font-semibold flex-1 text-[var(--t-text-primary)]">Select Host</h2>
        </div>
      )}

      {/* Toolbar */}
      <div
        className="flex items-center gap-2 px-3 py-2 shrink-0 bg-[var(--t-bg-toolbar)] border-b border-b-[var(--t-bg-terminal)]"
      >
        <button
          onClick={() => { setHomePendingAction({ action: "create" }); setActiveNav("hosts"); }}
          className="flex items-center gap-1.5 px-3 h-8 text-xs font-bold tracking-wider transition-colors shrink-0 rounded-lg whitespace-nowrap bg-[var(--t-bg-input)] text-[var(--t-text-primary)]"
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-bg-input-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "var(--t-bg-input)")}
          type="button"
        >
          <Icon icon="lucide:server" width={14} />
          NEW HOST
        </button>

        <div className="flex-1 relative">
          <Icon icon="lucide:filter" width={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--t-text-dim)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter hosts..."
            className="w-full pl-8 pr-2 h-8 rounded-lg text-xs outline-none bg-[var(--t-bg-input)] border border-[var(--t-border)] text-[var(--t-text-primary)]"
            onFocus={(e) => (e.currentTarget.style.borderColor = "var(--t-accent)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--t-border)")}
          />
        </div>

        <ToolbarDropdown
          icon={SORT_MODE_ICONS[sortMode]}
          value={sortMode}
          menuWidth={200}
          options={[
            { value: "name-asc",  label: "A → Z",       icon: "lucide:arrow-up-a-z" },
            { value: "name-desc", label: "Z → A",       icon: "lucide:arrow-down-a-z" },
            { value: "newest",    label: "Newest first", icon: "lucide:arrow-down-0-1" },
            { value: "oldest",    label: "Oldest first", icon: "lucide:arrow-up-0-1" },
          ]}
          onChange={setSortMode}
        />
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto py-1.5 px-2">
        <HostRow
          avatar={
            <div
              className="rounded-lg flex items-center justify-center shrink-0 w-[1.867rem] h-[1.867rem] bg-[var(--t-bg-elevated)] text-[var(--t-text-dim)]"
            >
              <Icon icon="lucide:monitor" width={14} />
            </div>
          }
          name="Local Machine"
          sub="This computer"
          isSelected={false}
          onClick={() => onPick({ kind: "local" })}
        />

        {connections.length === 0 && (
          <p className="px-3 py-4 text-xs text-center text-[var(--t-text-muted)]">No hosts configured</p>
        )}
        {connections.length > 0 && filtered.length === 0 && (
          <p className="px-3 py-4 text-xs text-center text-[var(--t-text-muted)]">No hosts match</p>
        )}

        {filtered.map((c) => (
          <HostRow
            key={c.id}
            avatar={<ConnectionAvatar connection={c} size={28} />}
            name={c.name ?? `${c.username}@${c.host}`}
            sub={`${c.username}@${c.host}:${c.port}`}
            isSelected={c.id === selectedHostId}
            onClick={() => onPick({ kind: "remote", connection: c })}
          />
        ))}
      </div>
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
        <p className="text-sm truncate font-medium text-[var(--t-text-bright)]">{name}</p>
        <p className="text-xs truncate text-[var(--t-text-secondary)]">{sub}</p>
      </div>
      {isSelected && <Icon icon="lucide:check" width={14} className="text-[var(--t-accent)] shrink-0" />}
    </button>
  );
}
