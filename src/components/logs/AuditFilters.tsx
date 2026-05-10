import { useState } from "react";
import type { ReactNode } from "react";
import { useAuditStore } from "@/stores/auditStore";
import type { LayoutMode } from "@/stores/auditStore";
import { FilterInput } from "@/components/shared/ToolbarViewControls";
import { ToolbarDropdown } from "@/components/shared/ToolbarDropdown";
import { getAuditTimeRange, type AuditTimeRange } from "./auditLogToolbarUtils";

const ACTION_OPTIONS = [
  { value: "", label: "All actions" },
  { value: "member.invited",      label: "Member invited" },
  { value: "member.joined",       label: "Member joined" },
  { value: "member.removed",      label: "Member removed" },
  { value: "member.role_changed", label: "Role changed" },
  { value: "connection.created",  label: "Host created" },
  { value: "connection.updated",  label: "Host updated" },
  { value: "connection.deleted",  label: "Host deleted" },
  { value: "identity.created",    label: "Identity created" },
  { value: "identity.updated",    label: "Identity updated" },
  { value: "identity.deleted",    label: "Identity deleted" },
  { value: "key.created",         label: "Key created" },
  { value: "key.updated",         label: "Key updated" },
  { value: "key.deleted",         label: "Key deleted" },
  { value: "snippet.created",     label: "Snippet created" },
  { value: "snippet.updated",     label: "Snippet updated" },
  { value: "snippet.deleted",     label: "Snippet deleted" },
  { value: "folder.created",      label: "Folder created" },
  { value: "folder.updated",      label: "Folder updated" },
  { value: "folder.deleted",      label: "Folder deleted" },
  { value: "port_forward.created",label: "Port forward created" },
  { value: "port_forward.updated",label: "Port forward updated" },
  { value: "port_forward.deleted",label: "Port forward deleted" },
  { value: "vault.renamed",       label: "Vault renamed" },
  { value: "vault.key_rotated",   label: "Key rotated" },
  { value: "role.created",        label: "Role created" },
  { value: "role.updated",        label: "Role updated" },
  { value: "role.deleted",        label: "Role deleted" },
  { value: "connection.started",  label: "Connection started" },
  { value: "connection.ended",    label: "Connection ended" },
  { value: "secret.viewed",       label: "Secret revealed" },
  { value: "session.started",     label: "Session started" },
  { value: "session.ended",       label: "Session ended" },
  { value: "session.joined",      label: "Session joined" },
];

interface Props {
  actors: Array<{ id: string; name: string }>;
  search: string;
  onSearchChange: (value: string) => void;
  layout: LayoutMode;
  onLayoutChange: (mode: LayoutMode) => void;
  actions?: ReactNode;
}

const inputCls = `
  text-xs bg-[var(--t-bg-input)] border border-[var(--t-border)] rounded-lg
  px-2.5 h-7 text-[var(--t-text-primary)] outline-none
  focus:border-[var(--t-accent)]
`.trim();

const TIME_RANGE_OPTIONS: Array<{ value: AuditTimeRange; label: string; icon: string }> = [
  { value: "last-day", label: "Last 24 hours", icon: "lucide:clock-3" },
  { value: "last-week", label: "Last week", icon: "lucide:calendar-days" },
  { value: "last-month", label: "Last 30 days", icon: "lucide:calendar-range" },
  { value: "all", label: "All time", icon: "lucide:infinity" },
  { value: "custom", label: "Custom range", icon: "lucide:calendar-clock" },
];

const LAYOUT_OPTIONS: Array<{ value: LayoutMode; label: string; icon: string }> = [
  { value: "timeline", label: "Timeline", icon: "lucide:layout-list" },
  { value: "list", label: "List", icon: "lucide:table" },
];

function timeRangeLabel(range: AuditTimeRange): string {
  return TIME_RANGE_OPTIONS.find((option) => option.value === range)?.label ?? "Last week";
}

export function AuditFilters({ actors, search, onSearchChange, layout, onLayoutChange, actions }: Props) {
  const filters = useAuditStore((s) => s.filters);
  const setFilter = useAuditStore((s) => s.setFilter);
  const resetFilters = useAuditStore((s) => s.resetFilters);
  const [timeRange, setTimeRange] = useState<AuditTimeRange>("last-week");

  const hasActiveFilters = !!(search.trim() || filters.actions?.length || filters.actor_id || timeRange !== "last-week");

  function handleTimeRangeChange(range: AuditTimeRange) {
    setTimeRange(range);
    if (range === "custom") return;
    const next = getAuditTimeRange(range);
    setFilter("from", next.from);
    setFilter("to", next.to);
  }

  function handleReset() {
    onSearchChange("");
    setTimeRange("last-week");
    resetFilters();
  }

  return (
    <div className="flex items-center gap-2 px-5 py-2.5 bg-[var(--t-bg-toolbar)] border-b border-b-[var(--t-bg-terminal)]">
      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
        <FilterInput value={search} onChange={onSearchChange} placeholder="Filter logs..." width={176} />

        <ToolbarDropdown icon={layout === "timeline" ? "lucide:layout-list" : "lucide:table"} value={layout} options={LAYOUT_OPTIONS} onChange={onLayoutChange} />

        <ToolbarDropdown
          icon="lucide:user-round"
          value={filters.actor_id ?? ""}
          menuWidth={220}
          options={[
            { value: "", label: "All actors", icon: "lucide:users-round" },
            ...actors.map((actor) => ({ value: actor.id, label: actor.name, icon: "lucide:user-round" })),
          ]}
          onChange={(value) => setFilter("actor_id", value || undefined)}
        />

        <ToolbarDropdown
          multiSelect
          searchable
          icon="lucide:activity"
          multiValue={filters.actions ?? []}
          menuWidth={220}
          options={ACTION_OPTIONS.map((option) => ({ ...option, icon: option.value ? "lucide:activity" : "lucide:list-filter" }))}
          onMultiChange={(values) => setFilter("actions", values.length ? values : undefined)}
        />

        <ToolbarDropdown
          icon={TIME_RANGE_OPTIONS.find((o) => o.value === timeRange)?.icon ?? "lucide:calendar-days"}
          label={timeRangeLabel(timeRange)}
          value={timeRange}
          menuWidth={190}
          options={TIME_RANGE_OPTIONS}
          onChange={handleTimeRangeChange}
        />

        {timeRange === "custom" && (
          <div className="flex items-center gap-1.5">
            <input
              type="datetime-local"
              className={inputCls}
              value={filters.from ? filters.from.slice(0, 16) : ""}
              onChange={(e) => setFilter("from", e.target.value ? new Date(e.target.value).toISOString() : undefined)}
              title="From date"
            />
            <span className="text-xs text-[var(--t-text-dim)]">to</span>
            <input
              type="datetime-local"
              className={inputCls}
              value={filters.to ? filters.to.slice(0, 16) : ""}
              onChange={(e) => setFilter("to", e.target.value ? new Date(e.target.value).toISOString() : undefined)}
              title="To date"
            />
          </div>
        )}

        {hasActiveFilters && (
          <button
            onClick={handleReset}
            className="text-xs px-2.5 h-7 rounded-lg text-[var(--t-text-dim)] hover:text-[var(--t-text-primary)] transition-colors"
            type="button"
          >
            Reset
          </button>
        )}
      </div>

      <div className="flex-1" />

      {actions}
    </div>
  );
}
