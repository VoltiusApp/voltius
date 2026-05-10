import { Icon } from "@iconify/react";
import type { AuditLog } from "@/services/auditService";

// ─── Action metadata ──────────────────────────────────────────────────────────

export interface ActionMeta {
  icon: string;
  color: string;
  label: (log: AuditLog) => string;
}

export const ACTION_META: Record<string, ActionMeta> = {
  "member.invited":      { icon: "lucide:user-plus",  color: "#3b82f6", label: (l) => `invited ${l.target_name ?? l.target_id ?? "a user"}` },
  "member.joined":       { icon: "lucide:user-check",  color: "#3b82f6", label: (l) => `joined the team as ${l.metadata?.role ?? "member"}` },
  "member.removed":      { icon: "lucide:user-minus",  color: "#ef4444", label: (l) => `removed ${l.target_name ?? l.target_id ?? "a member"}` },
  "member.role_changed": { icon: "lucide:user-cog",    color: "#3b82f6", label: (l) => `changed role for ${l.target_id ?? "a member"}` },
  "vault.created":       { icon: "lucide:database",    color: "#8b5cf6", label: (l) => `created vault "${l.target_name ?? l.target_id ?? ""}"` },
  "vault.deleted":       { icon: "lucide:database",    color: "#ef4444", label: (l) => `deleted vault "${l.target_name ?? l.target_id ?? ""}"` },
  "vault.renamed":       { icon: "lucide:database",    color: "#8b5cf6", label: (l) => `renamed vault to "${l.target_name ?? l.target_id ?? ""}"` },
  "vault.key_rotated":   { icon: "lucide:key",         color: "#8b5cf6", label: (l) => `rotated key for vault "${l.target_name ?? l.target_id ?? ""}"` },
  "role.created":        { icon: "lucide:shield",      color: "#f59e0b", label: (l) => `created role "${l.target_name ?? ""}"` },
  "role.updated":        { icon: "lucide:shield",      color: "#f59e0b", label: (l) => `updated role "${l.target_name ?? l.target_id ?? ""}"` },
  "role.deleted":        { icon: "lucide:shield-off",  color: "#f59e0b", label: (l) => `deleted role "${l.target_name ?? l.target_id ?? ""}"` },
  "permission.granted":  { icon: "lucide:shield-check",color: "#f59e0b", label: (l) => `granted permission on ${l.target_name ?? l.target_id ?? "a resource"}` },
  "permission.revoked":  { icon: "lucide:shield-x",    color: "#f59e0b", label: (l) => `revoked permission on ${l.target_name ?? l.target_id ?? "a resource"}` },
  "connection.created":  { icon: "lucide:server",      color: "#3b82f6", label: (l) => `created host "${l.target_name ?? l.target_id ?? ""}"` },
  "connection.updated":  { icon: "lucide:server-cog",  color: "#3b82f6", label: (l) => `updated host "${l.target_name ?? l.target_id ?? ""}"` },
  "connection.deleted":  { icon: "lucide:server-off",  color: "#ef4444", label: (l) => `deleted host "${l.target_name ?? l.target_id ?? ""}"` },
  "connection.started":  { icon: "lucide:terminal",    color: "#10b981", label: (l) => `connected to ${l.target_name ?? l.target_id ?? "a host"}` },
  "connection.ended":    { icon: "lucide:terminal",    color: "#6b7280", label: (l) => `disconnected from ${l.target_name ?? l.target_id ?? "a host"}` },
  "identity.created":    { icon: "lucide:id-card",     color: "#14b8a6", label: (l) => `created identity "${l.target_name ?? l.target_id ?? ""}"` },
  "identity.updated":    { icon: "lucide:id-card",     color: "#14b8a6", label: (l) => `updated identity "${l.target_name ?? l.target_id ?? ""}"` },
  "identity.deleted":    { icon: "lucide:id-card",     color: "#ef4444", label: (l) => `deleted identity "${l.target_name ?? l.target_id ?? ""}"` },
  "key.created":         { icon: "lucide:key-round",   color: "#8b5cf6", label: (l) => `created key "${l.target_name ?? l.target_id ?? ""}"` },
  "key.updated":         { icon: "lucide:key-round",   color: "#8b5cf6", label: (l) => `updated key "${l.target_name ?? l.target_id ?? ""}"` },
  "key.deleted":         { icon: "lucide:key-round",   color: "#ef4444", label: (l) => `deleted key "${l.target_name ?? l.target_id ?? ""}"` },
  "snippet.created":     { icon: "lucide:braces",      color: "#06b6d4", label: (l) => `created snippet "${l.target_name ?? l.target_id ?? ""}"` },
  "snippet.updated":     { icon: "lucide:braces",      color: "#06b6d4", label: (l) => `updated snippet "${l.target_name ?? l.target_id ?? ""}"` },
  "snippet.deleted":     { icon: "lucide:braces",      color: "#ef4444", label: (l) => `deleted snippet "${l.target_name ?? l.target_id ?? ""}"` },
  "folder.created":      { icon: "lucide:folder-plus", color: "#f59e0b", label: (l) => `created folder "${l.target_name ?? l.target_id ?? ""}"` },
  "folder.updated":      { icon: "lucide:folder-cog",  color: "#f59e0b", label: (l) => `updated folder "${l.target_name ?? l.target_id ?? ""}"` },
  "folder.deleted":      { icon: "lucide:folder-x",    color: "#ef4444", label: (l) => `deleted folder "${l.target_name ?? l.target_id ?? ""}"` },
  "port_forward.created":{ icon: "lucide:route",       color: "#10b981", label: (l) => `created port forward "${l.target_name ?? l.target_id ?? ""}"` },
  "port_forward.updated":{ icon: "lucide:route",       color: "#10b981", label: (l) => `updated port forward "${l.target_name ?? l.target_id ?? ""}"` },
  "port_forward.deleted":{ icon: "lucide:route-off",   color: "#ef4444", label: (l) => `deleted port forward "${l.target_name ?? l.target_id ?? ""}"` },
  "secret.viewed":       { icon: "lucide:eye",         color: "#f59e0b", label: (l) => `revealed secret "${l.target_name ?? l.target_id ?? ""}"` },
  "session.started":     { icon: "lucide:monitor",     color: "#06b6d4", label: () => `started terminal session` },
  "session.ended":       { icon: "lucide:monitor",     color: "#6b7280", label: () => `ended terminal session` },
  "session.joined":      { icon: "lucide:monitor",     color: "#06b6d4", label: () => `joined terminal session` },
  "session.left":        { icon: "lucide:monitor",     color: "#6b7280", label: () => `left terminal session` },
};

export const FALLBACK_META: ActionMeta = {
  icon: "lucide:activity",
  color: "var(--t-text-dim)",
  label: (l) => l.action,
};

// ─── Avatar ───────────────────────────────────────────────────────────────────

const AVATAR_COLORS = ["#6366f1","#8b5cf6","#ec4899","#ef4444","#f59e0b","#10b981","#3b82f6","#14b8a6"];

export function avatarColor(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  log: AuditLog;
  showDate?: boolean;
}

export function AuditEventRow({ log, showDate = false }: Props) {
  const meta = ACTION_META[log.action] ?? FALLBACK_META;
  const time = new Date(log.created_at);
  const timeStr = time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dateStr = time.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });

  return (
    <div
      className="flex items-start gap-3 px-4 py-2.5 hover:bg-[var(--t-bg-elevated)] rounded-lg transition-colors"
    >
      {/* Actor avatar */}
      <div
        className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold select-none mt-0.5"
        style={{ background: avatarColor(log.actor_name) }}
        title={log.actor_name}
      >
        {log.actor_name[0]?.toUpperCase() ?? "?"}
      </div>

      {/* Action dot */}
      <div
        className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center mt-1"
        style={{ background: `${meta.color}22`, color: meta.color }}
      >
        <Icon icon={meta.icon} width={11} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-medium text-[var(--t-text-primary)]">{log.actor_name}</span>
          <span className="text-sm text-[var(--t-text-secondary)]">{meta.label(log)}</span>
          {log.source === "client" && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
              style={{ background: "var(--t-bg-elevated)", color: "var(--t-text-dim)", border: "1px solid var(--t-border)" }}
              title="Reported by the client app — non-authoritative"
            >
              client
            </span>
          )}
        </div>
        {log.ip_address && (
          <div className="text-xs text-[var(--t-text-dim)] mt-0.5">{log.ip_address}</div>
        )}
      </div>

      {/* Time */}
      <div className="shrink-0 text-right">
        {showDate && <div className="text-xs text-[var(--t-text-dim)]">{dateStr}</div>}
        <div className="text-xs text-[var(--t-text-dim)]">{timeStr}</div>
      </div>
    </div>
  );
}
