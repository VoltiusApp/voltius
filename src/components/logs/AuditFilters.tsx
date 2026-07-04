import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useAuditStore } from "@/stores/auditStore";
import type { LayoutMode } from "@/stores/auditStore";
import { FilterInput } from "@/components/shared/ToolbarViewControls";
import { ToolbarDropdown } from "@/components/shared/ToolbarDropdown";
import { Pills } from "@/components/shared/Pills";
import { getAuditTimeRange, type AuditTimeRange } from "./auditLogToolbarUtils";

function getActionOptions(t: TFunction) {
  return [
    { value: "", label: t("logs.filters.actionOptions.all") },
    { value: "member.invited",      label: t("logs.filters.actionOptions.memberInvited") },
    { value: "member.joined",       label: t("logs.filters.actionOptions.memberJoined") },
    { value: "member.removed",      label: t("logs.filters.actionOptions.memberRemoved") },
    { value: "member.role_changed", label: t("logs.filters.actionOptions.memberRoleChanged") },
    { value: "connection.created",  label: t("logs.filters.actionOptions.connectionCreated") },
    { value: "connection.updated",  label: t("logs.filters.actionOptions.connectionUpdated") },
    { value: "connection.deleted",  label: t("logs.filters.actionOptions.connectionDeleted") },
    { value: "identity.created",    label: t("logs.filters.actionOptions.identityCreated") },
    { value: "identity.updated",    label: t("logs.filters.actionOptions.identityUpdated") },
    { value: "identity.deleted",    label: t("logs.filters.actionOptions.identityDeleted") },
    { value: "key.created",         label: t("logs.filters.actionOptions.keyCreated") },
    { value: "key.updated",         label: t("logs.filters.actionOptions.keyUpdated") },
    { value: "key.deleted",         label: t("logs.filters.actionOptions.keyDeleted") },
    { value: "snippet.created",     label: t("logs.filters.actionOptions.snippetCreated") },
    { value: "snippet.updated",     label: t("logs.filters.actionOptions.snippetUpdated") },
    { value: "snippet.deleted",     label: t("logs.filters.actionOptions.snippetDeleted") },
    { value: "folder.created",      label: t("logs.filters.actionOptions.folderCreated") },
    { value: "folder.updated",      label: t("logs.filters.actionOptions.folderUpdated") },
    { value: "folder.deleted",      label: t("logs.filters.actionOptions.folderDeleted") },
    { value: "port_forward.created",label: t("logs.filters.actionOptions.portForwardCreated") },
    { value: "port_forward.updated",label: t("logs.filters.actionOptions.portForwardUpdated") },
    { value: "port_forward.deleted",label: t("logs.filters.actionOptions.portForwardDeleted") },
    { value: "vault.renamed",       label: t("logs.filters.actionOptions.vaultRenamed") },
    { value: "vault.key_rotated",   label: t("logs.filters.actionOptions.vaultKeyRotated") },
    { value: "role.created",        label: t("logs.filters.actionOptions.roleCreated") },
    { value: "role.updated",        label: t("logs.filters.actionOptions.roleUpdated") },
    { value: "role.deleted",        label: t("logs.filters.actionOptions.roleDeleted") },
    { value: "connection.started",  label: t("logs.filters.actionOptions.connectionStarted") },
    { value: "connection.ended",    label: t("logs.filters.actionOptions.connectionEnded") },
    { value: "secret.viewed",       label: t("logs.filters.actionOptions.secretViewed") },
    { value: "session.started",     label: t("logs.filters.actionOptions.sessionStarted") },
    { value: "session.ended",       label: t("logs.filters.actionOptions.sessionEnded") },
    { value: "session.joined",      label: t("logs.filters.actionOptions.sessionJoined") },
  ];
}

interface Props {
  actors: Array<{ id: string; name: string }>;
  search: string;
  onSearchChange: (value: string) => void;
  layout: LayoutMode;
  onLayoutChange: (mode: LayoutMode) => void;
  actions?: ReactNode;
}

const inputCls = `
  text-xs bg-(--t-bg-input) border border-(--t-border) rounded-lg
  px-2.5 h-7 text-(--t-text-primary) outline-hidden
  focus:border-(--t-accent)
`.trim();

function getTimeRangeOptions(t: TFunction): Array<{ value: AuditTimeRange; label: string; icon: string }> {
  return [
    { value: "last-day", label: t("logs.timeRange.lastDay"), icon: "lucide:clock-3" },
    { value: "last-week", label: t("logs.timeRange.lastWeek"), icon: "lucide:calendar-days" },
    { value: "last-month", label: t("logs.timeRange.lastMonth"), icon: "lucide:calendar-range" },
    { value: "all", label: t("logs.timeRange.all"), icon: "lucide:infinity" },
    { value: "custom", label: t("logs.timeRange.custom"), icon: "lucide:calendar-clock" },
  ];
}

function getLayoutOptions(t: TFunction): Array<{ value: LayoutMode; label: string; icon: string }> {
  return [
    { value: "timeline", label: t("logs.layout.timeline"), icon: "lucide:layout-list" },
    { value: "horizontal", label: t("logs.layout.horizontal"), icon: "lucide:git-commit-horizontal" },
    { value: "list", label: t("logs.layout.list"), icon: "lucide:table" },
  ];
}

function timeRangeLabel(range: AuditTimeRange, options: Array<{ value: AuditTimeRange; label: string }>, t: TFunction): string {
  return options.find((option) => option.value === range)?.label ?? t("logs.timeRange.lastWeek");
}

export function AuditFilters({ actors, search, onSearchChange, layout, onLayoutChange, actions }: Props) {
  const { t } = useTranslation();
  const filters = useAuditStore((s) => s.filters);
  const setFilter = useAuditStore((s) => s.setFilter);
  const resetFilters = useAuditStore((s) => s.resetFilters);
  const [timeRange, setTimeRange] = useState<AuditTimeRange>("last-week");

  const actionOptions = getActionOptions(t);
  const timeRangeOptions = getTimeRangeOptions(t);
  const layoutOptions = getLayoutOptions(t);

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
    <div className="flex items-center gap-2 px-5 py-2.5 shrink-0 chrome-toolbar">
      <div className="flex items-center gap-1.5 min-w-0">
        <FilterInput value={search} onChange={onSearchChange} placeholder={t("logs.filters.searchPlaceholder")} width={176} shortcutId="filter" />

        <Pills options={layoutOptions} value={layout} onChange={onLayoutChange} />

        <ToolbarDropdown
          icon="lucide:user-round"
          value={filters.actor_id ?? ""}
          menuWidth={220}
          options={[
            { value: "", label: t("logs.filters.allActors"), icon: "lucide:users-round" },
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
          options={actionOptions.map((option) => ({ ...option, icon: option.value ? "lucide:activity" : "lucide:list-filter" }))}
          onMultiChange={(values) => setFilter("actions", values.length ? values : undefined)}
        />

        <ToolbarDropdown
          icon={timeRangeOptions.find((o) => o.value === timeRange)?.icon ?? "lucide:calendar-days"}
          label={timeRangeLabel(timeRange, timeRangeOptions, t)}
          value={timeRange}
          menuWidth={190}
          options={timeRangeOptions}
          onChange={handleTimeRangeChange}
        />

        {timeRange === "custom" && (
          <div className="flex items-center gap-1.5 shrink-0">
            <input
              type="datetime-local"
              className={inputCls}
              value={filters.from ? filters.from.slice(0, 16) : ""}
              onChange={(e) => setFilter("from", e.target.value ? new Date(e.target.value).toISOString() : undefined)}
              title={t("logs.filters.fromDate")}
            />
            <span className="text-xs text-(--t-text-dim)">{t("logs.filters.dateRangeSeparator")}</span>
            <input
              type="datetime-local"
              className={inputCls}
              value={filters.to ? filters.to.slice(0, 16) : ""}
              onChange={(e) => setFilter("to", e.target.value ? new Date(e.target.value).toISOString() : undefined)}
              title={t("logs.filters.toDate")}
            />
          </div>
        )}

        {hasActiveFilters && (
          <button
            onClick={handleReset}
            className="text-xs px-2.5 h-7 rounded-lg text-(--t-text-dim) hover:text-(--t-text-primary) transition-colors shrink-0"
            type="button"
          >
            {t("logs.filters.reset")}
          </button>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2 shrink-0">
        {actions}
      </div>
    </div>
  );
}
