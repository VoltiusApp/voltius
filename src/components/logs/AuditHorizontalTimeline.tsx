import { Icon } from "@iconify/react";
import type { AuditLog } from "@/services/auditService";
import { ACTION_META, FALLBACK_META, avatarColor } from "./AuditEventRow";

interface Props {
  logs: AuditLog[];
}

interface TimelineEvent {
  log: AuditLog;
  position: number;
  lane: number;
}

interface TimelineBucket {
  key: string;
  start: number;
  end: number;
  left: number;
  width: number;
  label: string;
  sublabel?: string;
}

interface TimelineScale {
  min: number;
  max: number;
  buckets: TimelineBucket[];
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

function startOfHour(ts: number): number {
  const d = new Date(ts);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfMonth(ts: number): number {
  const d = new Date(ts);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function addMonths(ts: number, count: number): number {
  const d = new Date(ts);
  d.setMonth(d.getMonth() + count);
  return d.getTime();
}

function bucketLabel(ts: number, unit: "hour" | "day" | "week" | "month"): { label: string; sublabel?: string } {
  const d = new Date(ts);
  if (unit === "hour") {
    return {
      label: d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      sublabel: d.toLocaleDateString([], { month: "short", day: "numeric" }),
    };
  }
  if (unit === "day") {
    return {
      label: d.toLocaleDateString([], { weekday: "short", day: "numeric" }),
      sublabel: d.toLocaleDateString([], { month: "short" }),
    };
  }
  if (unit === "week") {
    return {
      label: `Week ${d.toLocaleDateString([], { month: "short", day: "numeric" })}`,
      sublabel: d.getFullYear().toString(),
    };
  }
  return {
    label: d.toLocaleDateString([], { month: "short" }),
    sublabel: d.getFullYear().toString(),
  };
}

function positionFor(ts: number, min: number, max: number): number {
  const span = Math.max(1, max - min);
  return Math.max(2, Math.min(98, ((ts - min) / span) * 96 + 2));
}

function buildTimelineScale(logs: AuditLog[]): TimelineScale | null {
  const times = logs.map((log) => Date.parse(log.created_at)).filter(Number.isFinite);
  if (times.length === 0) return null;
  const rawMin = Math.min(...times);
  const rawMax = Math.max(...times);
  const rawSpan = Math.max(1, rawMax - rawMin);
  const unit: "hour" | "day" | "week" | "month" = rawSpan <= 2 * DAY
    ? "hour"
    : rawSpan <= 45 * DAY
      ? "day"
      : rawSpan <= 180 * DAY
        ? "week"
        : "month";
  const step = unit === "hour" ? 3 * HOUR : unit === "day" ? DAY : unit === "week" ? WEEK : 0;
  const min = unit === "hour" ? startOfHour(rawMin) : unit === "month" ? startOfMonth(rawMin) : startOfDay(rawMin);
  const max = unit === "month" ? addMonths(startOfMonth(rawMax), 1) : (unit === "hour" ? startOfHour(rawMax) + HOUR : startOfDay(rawMax) + DAY);
  const buckets: TimelineBucket[] = [];

  for (let start = min, index = 0; start < max && index < 96; index++) {
    const end = unit === "month" ? addMonths(start, 1) : start + step;
    const left = positionFor(start, min, max);
    const right = positionFor(Math.min(end, max), min, max);
    const { label, sublabel } = bucketLabel(start, unit);
    buckets.push({ key: `${unit}-${start}`, start, end, left, width: Math.max(2, right - left), label, sublabel });
    start = end;
  }

  return { min, max, buckets };
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function initials(name: string): string {
  return name
    .split(/\s+|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";
}

function buildTimelineEvents(logs: AuditLog[], scale: TimelineScale | null): TimelineEvent[] {
  const ordered = [...logs].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const lastByLane = Array.from({ length: 6 }, () => -100);

  return ordered.map((log, index) => {
    const parsed = Date.parse(log.created_at);
    const position = !scale || !Number.isFinite(parsed)
      ? 50
      : positionFor(parsed, scale.min, scale.max);
    let lane = lastByLane.findIndex((last) => position - last >= 5);
    if (lane === -1) lane = index % lastByLane.length;
    lastByLane[lane] = position;
    return { log, position, lane };
  });
}

export function AuditHorizontalTimeline({ logs }: Props) {
  const scale = buildTimelineScale(logs);
  const events = buildTimelineEvents(logs, scale);

  if (logs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-(--t-text-dim) py-12">
        No events match your filters.
      </div>
    );
  }

  return (
    <div className="h-full overflow-x-auto overflow-y-hidden px-5 py-6">
      <div className="relative min-w-4xl h-104 rounded-2xl border border-(--t-border) bg-(--t-bg-card) overflow-hidden">
        {scale && (
          <div className="absolute inset-x-8 top-0 h-20 border-b border-(--t-border) bg-(--t-bg-elevated)/40">
            {scale.buckets.map((bucket) => (
              <div
                key={bucket.key}
                className="absolute top-0 h-full border-l border-(--t-border) px-2 py-3"
                style={{ left: `${bucket.left}%`, width: `${bucket.width}%` }}
              >
                <div className="text-[11px] font-semibold text-(--t-text-primary) truncate">{bucket.label}</div>
                {bucket.sublabel && <div className="text-[10px] text-(--t-text-dim) truncate">{bucket.sublabel}</div>}
              </div>
            ))}
          </div>
        )}

        <div className="absolute inset-x-8 top-1/2 h-px bg-(--t-border)" />

        {scale?.buckets.map((bucket) => (
          <div
            key={`${bucket.key}-grid`}
            className="absolute top-20 bottom-0 w-px bg-(--t-border)/70"
            style={{ left: `${bucket.left}%` }}
          />
        ))}

        {events.map(({ log, position, lane }) => {
          const meta = ACTION_META[log.action] ?? FALLBACK_META;
          const above = lane % 2 === 0;
          const depth = Math.floor(lane / 2);
          const offset = 54 + depth * 58;
          const avatarTop = above ? `calc(50% - ${offset}px)` : `calc(50% + ${offset - 28}px)`;
          const connectorHeight = `${Math.max(24, offset - 28)}px`;
          return (
            <div
              key={log.id}
              className="group absolute -translate-x-1/2 outline-hidden"
              style={{ left: `${position}%`, top: avatarTop }}
              tabIndex={0}
            >
              <div
                className="absolute left-1/2 w-px -translate-x-1/2 bg-(--t-border-hover)"
                style={{ top: above ? 28 : -Number.parseInt(connectorHeight, 10), height: connectorHeight }}
              />
              <div
                className="relative z-10 w-8 h-8 rounded-full flex items-center justify-center text-white text-[10px] font-bold border-2 shadow-lg transition-transform group-hover:scale-110 group-focus:scale-110"
                style={{ background: avatarColor(log.actor_name), borderColor: meta.color }}
                title={log.actor_name}
              >
                {initials(log.actor_name)}
              </div>
              <div
                className="pointer-events-none absolute z-30 w-72 rounded-xl border border-(--t-border) bg-(--t-bg-card) p-3 opacity-0 shadow-2xl transition-opacity group-hover:opacity-100 group-focus:opacity-100"
                style={{
                  left: position > 78 ? "auto" : "50%",
                  right: position > 78 ? "50%" : "auto",
                  top: above ? "2.75rem" : "auto",
                  bottom: above ? "auto" : "2.75rem",
                }}
              >
                <div className="flex items-start gap-2">
                  <div
                    className="mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: `${meta.color}22`, color: meta.color }}
                  >
                    <Icon icon={meta.icon} width={14} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-(--t-text-primary) truncate">{log.actor_name}</div>
                    <div className="text-sm text-(--t-text-secondary) leading-snug">{meta.label(log)}</div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-(--t-text-dim)">
                      <span>{formatTime(log.created_at)}</span>
                      {log.source === "client" && <span className="rounded-full border border-(--t-border) px-1.5 py-0.5">client</span>}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
