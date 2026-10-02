import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import type { AuditLog } from "@/services/auditService";
import { avatarColor } from "@/components/shared/AvatarStack";
import { LOCAL_ACTOR_ID } from "@/services/localAuditService";
import { useIdentityStore } from "@/stores/identityStore";
import { findIdentityIn } from "@/services/credentialScope";
import { formatDate, formatTime, SHORT_DATE, HOUR_MINUTE } from "@/utils/localeFormat";

// ─── Action metadata ──────────────────────────────────────────────────────────

export interface ActionMeta {
  icon: string;
  color: string;
  label: (log: AuditLog) => string;
}

const fallbackUser = () => i18n.t("logs.eventLabels.fallbackUser");
const fallbackMember = () => i18n.t("logs.eventLabels.fallbackMember");
const fallbackRole = () => i18n.t("logs.eventLabels.fallbackRole");
const fallbackResource = () => i18n.t("logs.eventLabels.fallbackResource");
const fallbackHost = () => i18n.t("logs.eventLabels.fallbackHost");

/** Who did it. The local log's only actor is this user, named in the app language. */
export function actorName(log: AuditLog): string {
  if (log.actor_id === LOCAL_ACTOR_ID) return i18n.t("logs.eventLabels.you");
  return log.actor_member_name ?? log.actor_name;
}

export function actorTitle(log: AuditLog): string {
  const name = actorName(log);
  return log.actor_member_name && name === log.actor_member_name ? `${name} (@${log.actor_name})` : name;
}

export const ACTION_META: Record<string, ActionMeta> = {
  "member.invited":              { icon: "lucide:user-plus",              color: "#3b82f6", label: (l) => i18n.t("logs.eventLabels.memberInvited", { name: l.target_name ?? l.target_id ?? fallbackUser() }) },
  "member.joined":               { icon: "lucide:user-check",              color: "#3b82f6", label: (l) => i18n.t("logs.eventLabels.memberJoined", { role: l.metadata?.role ?? fallbackRole() }) },
  "member.removed":              { icon: "lucide:user-minus",              color: "#ef4444", label: (l) => i18n.t("logs.eventLabels.memberRemoved", { name: l.target_name ?? l.target_id ?? fallbackMember() }) },
  "member.renamed":              { icon: "lucide:id-card",                 color: "#3b82f6", label: (l) => {
    const name = l.target_name ?? l.target_id ?? fallbackMember();
    const to = l.metadata?.new as string | null | undefined;
    return to ? i18n.t("logs.eventLabels.memberRenamed", { name, to }) : i18n.t("logs.eventLabels.memberNameRemoved", { name });
  } },
  "member.role_changed":         { icon: "lucide:user-cog",                color: "#3b82f6", label: (l) => i18n.t("logs.eventLabels.memberRoleChanged", { name: l.target_name ?? l.target_id ?? fallbackMember() }) },
  "member.permissions_changed":  { icon: "lucide:sliders-horizontal",      color: "#3b82f6", label: (l) => i18n.t("logs.eventLabels.memberPermissionsChanged", { name: l.target_name ?? l.target_id ?? fallbackMember() }) },
  "vault.created":       { icon: "lucide:database",    color: "#8b5cf6", label: (l) => i18n.t("logs.eventLabels.vaultCreated", { name: l.target_name ?? l.target_id ?? "" }) },
  "vault.deleted":       { icon: "lucide:database",    color: "#ef4444", label: (l) => i18n.t("logs.eventLabels.vaultDeleted", { name: l.target_name ?? l.target_id ?? "" }) },
  "vault.renamed":       { icon: "lucide:database",    color: "#8b5cf6", label: (l) => i18n.t("logs.eventLabels.vaultRenamed", { name: l.target_name ?? l.target_id ?? "" }) },
  "vault.key_rotated":   { icon: "lucide:key",         color: "#8b5cf6", label: (l) => i18n.t("logs.eventLabels.vaultKeyRotated", { name: l.target_name ?? l.target_id ?? "" }) },
  "role.created":        { icon: "lucide:shield",      color: "#f59e0b", label: (l) => i18n.t("logs.eventLabels.roleCreated", { name: l.target_name ?? "" }) },
  "role.updated":        { icon: "lucide:shield",      color: "#f59e0b", label: (l) => i18n.t("logs.eventLabels.roleUpdated", { name: l.target_name ?? l.target_id ?? "" }) },
  "role.deleted":        { icon: "lucide:shield-off",  color: "#f59e0b", label: (l) => i18n.t("logs.eventLabels.roleDeleted", { name: l.target_name ?? l.target_id ?? "" }) },
  "permission.granted":  { icon: "lucide:shield-check",color: "#f59e0b", label: (l) => i18n.t("logs.eventLabels.permissionGranted", { name: l.target_name ?? l.target_id ?? fallbackResource() }) },
  "permission.revoked":  { icon: "lucide:shield-x",    color: "#f59e0b", label: (l) => i18n.t("logs.eventLabels.permissionRevoked", { name: l.target_name ?? l.target_id ?? fallbackResource() }) },
  "connection.created":  { icon: "lucide:server",      color: "#3b82f6", label: (l) => i18n.t("logs.eventLabels.connectionCreated", { name: l.target_name ?? l.target_id ?? "" }) },
  "connection.updated":  { icon: "lucide:server-cog",  color: "#3b82f6", label: (l) => i18n.t("logs.eventLabels.connectionUpdated", { name: l.target_name ?? l.target_id ?? "" }) },
  "connection.deleted":  { icon: "lucide:server-off",  color: "#ef4444", label: (l) => i18n.t("logs.eventLabels.connectionDeleted", { name: l.target_name ?? l.target_id ?? "" }) },
  "connection.started":  { icon: "lucide:terminal",    color: "#10b981", label: (l) => i18n.t("logs.eventLabels.connectionStarted", { name: l.target_name ?? l.target_id ?? fallbackHost() }) },
  "connection.ended":    { icon: "lucide:terminal",    color: "#6b7280", label: (l) => i18n.t("logs.eventLabels.connectionEnded", { name: l.target_name ?? l.target_id ?? fallbackHost() }) },
  "identity.created":    { icon: "lucide:id-card",     color: "#14b8a6", label: (l) => i18n.t("logs.eventLabels.identityCreated", { name: l.target_name ?? l.target_id ?? "" }) },
  "identity.updated":    { icon: "lucide:id-card",     color: "#14b8a6", label: (l) => i18n.t("logs.eventLabels.identityUpdated", { name: l.target_name ?? l.target_id ?? "" }) },
  "identity.deleted":    { icon: "lucide:id-card",     color: "#ef4444", label: (l) => i18n.t("logs.eventLabels.identityDeleted", { name: l.target_name ?? l.target_id ?? "" }) },
  "key.created":         { icon: "lucide:key-round",   color: "#8b5cf6", label: (l) => i18n.t("logs.eventLabels.keyCreated", { name: l.target_name ?? l.target_id ?? "" }) },
  "key.updated":         { icon: "lucide:key-round",   color: "#8b5cf6", label: (l) => i18n.t("logs.eventLabels.keyUpdated", { name: l.target_name ?? l.target_id ?? "" }) },
  "key.deleted":         { icon: "lucide:key-round",   color: "#ef4444", label: (l) => i18n.t("logs.eventLabels.keyDeleted", { name: l.target_name ?? l.target_id ?? "" }) },
  "snippet.created":     { icon: "lucide:braces",      color: "#06b6d4", label: (l) => i18n.t("logs.eventLabels.snippetCreated", { name: l.target_name ?? l.target_id ?? "" }) },
  "snippet.updated":     { icon: "lucide:braces",      color: "#06b6d4", label: (l) => i18n.t("logs.eventLabels.snippetUpdated", { name: l.target_name ?? l.target_id ?? "" }) },
  "snippet.deleted":     { icon: "lucide:braces",      color: "#ef4444", label: (l) => i18n.t("logs.eventLabels.snippetDeleted", { name: l.target_name ?? l.target_id ?? "" }) },
  "folder.created":      { icon: "lucide:folder-plus", color: "#f59e0b", label: (l) => i18n.t("logs.eventLabels.folderCreated", { name: l.target_name ?? l.target_id ?? "" }) },
  "folder.updated":      { icon: "lucide:folder-cog",  color: "#f59e0b", label: (l) => i18n.t("logs.eventLabels.folderUpdated", { name: l.target_name ?? l.target_id ?? "" }) },
  "folder.deleted":      { icon: "lucide:folder-x",    color: "#ef4444", label: (l) => i18n.t("logs.eventLabels.folderDeleted", { name: l.target_name ?? l.target_id ?? "" }) },
  "port_forward.created":{ icon: "lucide:route",       color: "#10b981", label: (l) => i18n.t("logs.eventLabels.portForwardCreated", { name: l.target_name ?? l.target_id ?? "" }) },
  "port_forward.updated":{ icon: "lucide:route",       color: "#10b981", label: (l) => i18n.t("logs.eventLabels.portForwardUpdated", { name: l.target_name ?? l.target_id ?? "" }) },
  "port_forward.deleted":{ icon: "lucide:route-off",   color: "#ef4444", label: (l) => i18n.t("logs.eventLabels.portForwardDeleted", { name: l.target_name ?? l.target_id ?? "" }) },
  "secret.viewed":       { icon: "lucide:eye",         color: "#f59e0b", label: (l) => i18n.t("logs.eventLabels.secretViewed", { name: l.target_name ?? l.target_id ?? "" }) },
  "session.started":     { icon: "lucide:monitor",     color: "#06b6d4", label: () => i18n.t("logs.eventLabels.sessionStarted") },
  "session.ended":       { icon: "lucide:monitor",     color: "#6b7280", label: () => i18n.t("logs.eventLabels.sessionEnded") },
  "session.joined":      { icon: "lucide:monitor",     color: "#06b6d4", label: () => i18n.t("logs.eventLabels.sessionJoined") },
  "session.left":        { icon: "lucide:monitor",     color: "#6b7280", label: () => i18n.t("logs.eventLabels.sessionLeft") },
};

export const FALLBACK_META: ActionMeta = {
  icon: "lucide:activity",
  color: "var(--t-text-dim)",
  label: (l) => l.action,
};

// ─── Component ────────────────────────────────────────────────────────────────

function AuditBadge({ accent, title, children }: { accent?: boolean; title?: string; children: React.ReactNode }) {
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
      title={title}
      style={
        accent
          ? { background: "color-mix(in srgb, var(--t-accent) 14%, transparent)", color: "var(--t-accent)", border: "1px solid color-mix(in srgb, var(--t-accent) 35%, transparent)" }
          : { background: "var(--t-bg-elevated)", color: "var(--t-text-dim)", border: "1px solid var(--t-border)" }
      }
    >
      {children}
    </span>
  );
}

interface Props {
  log: AuditLog;
  showDate?: boolean;
}

export function AuditEventRow({ log, showDate = false }: Props) {
  const { t } = useTranslation();
  const actionMeta = ACTION_META[log.action] ?? FALLBACK_META;
  const meta = log.metadata ?? {};
  const isConnect = log.action === "connection.started";
  const source = isConnect ? (meta.identity_source as string | undefined) : undefined;
  const fingerprint = isConnect && typeof meta.key_fingerprint === "string" ? meta.key_fingerprint : undefined;
  const sharedName = useIdentityStore((s) =>
    source === "team" ? findIdentityIn({ ownIdentities: s.identities, teamIdentities: s.teamIdentities }, String(meta.identity_id))?.name : undefined,
  );
  const actor = actorName(log);
  const time = new Date(log.created_at);
  const timeStr = formatTime(time, HOUR_MINUTE);
  const dateStr = formatDate(time, SHORT_DATE);

  return (
    <div
      className="flex items-start gap-3 px-4 py-2.5 hover:bg-(--t-bg-elevated) rounded-lg transition-colors"
    >
      {/* Actor avatar */}
      <div
        className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold select-none mt-0.5"
        style={{ background: avatarColor(log.actor_name) }}
        title={actorTitle(log)}
      >
        {actor[0]?.toUpperCase() ?? "?"}
      </div>

      {/* Action dot */}
      <div
        className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center mt-1"
        style={{ background: `${actionMeta.color}22`, color: actionMeta.color }}
      >
        <Icon icon={actionMeta.icon} width={11} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-medium text-(--t-text-primary)">{actor}</span>
          <span className="text-sm text-(--t-text-secondary)">{actionMeta.label(log)}</span>
          {source === "own" && <AuditBadge accent title={t("logs.badges.ownKeyTooltip")}>{t("logs.badges.ownKey")}</AuditBadge>}
          {source === "team" && <AuditBadge>{sharedName ? t("logs.badges.shared", { name: sharedName }) : t("logs.badges.sharedUnknown")}</AuditBadge>}
          {log.source === "client" && <AuditBadge title={t("logs.badges.clientTooltip")}>{t("logs.badges.client")}</AuditBadge>}
        </div>
        {(log.ip_address || fingerprint) && (
          <div className="text-xs text-(--t-text-dim) mt-0.5">
            {log.ip_address}
            {log.ip_address && fingerprint && " · "}
            {fingerprint && <span className="font-mono">{fingerprint}</span>}
          </div>
        )}
      </div>

      {/* Time */}
      <div className="shrink-0 text-right">
        {showDate && <div className="text-xs text-(--t-text-dim)">{dateStr}</div>}
        <div className="text-xs text-(--t-text-dim)">{timeStr}</div>
      </div>
    </div>
  );
}
