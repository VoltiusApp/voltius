import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { useTeamStore } from "@/stores/teamStore";
import type { CustomRole } from "@/stores/teamStore";
import { type Permission, PERM_BITS } from "@/hooks/usePermission";
import { getMyUserId } from "@/services/teamService";

// ─── Permission metadata ──────────────────────────────────────────────────────

const PERMISSIONS: Permission[] = [
  "VIEW_SECRETS", "COPY_SECRETS", "CONNECT",
  "EDIT_CONNECTIONS", "EDIT_IDENTITIES", "EDIT_KEYS", "EDIT_FOLDERS",
  "VIEW_AUDIT_LOG", "INVITE_MEMBERS", "MANAGE_MEMBERS",
  "CREATE_CUSTOM_ROLES", "MANAGE_VAULT",
  "START_TERMINAL_SESSION", "JOIN_TERMINAL_SESSION", "VIEW_TERMINAL_SESSIONS",
];

const PERM_META: Record<Permission, { label: string; description: string }> = {
  VIEW_SECRETS:           { label: "View secrets",       description: "See passwords and private keys in plain text" },
  COPY_SECRETS:           { label: "Copy secrets",       description: "Copy passwords and keys to clipboard" },
  CONNECT:                { label: "Connect",            description: "Launch SSH connections" },
  EDIT_CONNECTIONS:       { label: "Edit connections",   description: "Create, modify, and delete connections" },
  EDIT_IDENTITIES:        { label: "Edit identities",    description: "Create, modify, and delete SSH identities" },
  EDIT_KEYS:              { label: "Edit keys",          description: "Create, modify, and delete SSH keys" },
  EDIT_FOLDERS:           { label: "Edit folders",       description: "Manage folder structure" },
  VIEW_AUDIT_LOG:         { label: "View audit log",     description: "Read the activity audit log" },
  INVITE_MEMBERS:         { label: "Invite members",     description: "Invite new members to the vault" },
  MANAGE_MEMBERS:         { label: "Manage members",     description: "Change roles and remove members" },
  CREATE_CUSTOM_ROLES:    { label: "Manage roles",       description: "Create and edit custom roles" },
  MANAGE_VAULT:           { label: "Manage vault",       description: "Rename vault and manage vault settings" },
  START_TERMINAL_SESSION: { label: "Start sessions",     description: "Start multiplayer terminal sessions" },
  JOIN_TERMINAL_SESSION:  { label: "Join sessions",      description: "Join existing terminal sessions" },
  VIEW_TERMINAL_SESSIONS: { label: "View sessions",      description: "See active terminal sessions" },
};

// Built-in role bitmasks (read-only reference)
const BUILTIN_PERMISSIONS: Record<string, number> = {
  owner:        0x7FFF, // all 15 bits
  manager:      0x73FF, // all except CREATE_CUSTOM_ROLES (bit10) and MANAGE_VAULT (bit11)
  editor:       0x707F, // view+copy+connect+edit_* + terminal
  member:       0x7007, // view+copy+connect + terminal
  "connect-only": 0x7004, // connect + terminal only
};

const BUILTIN_LABELS: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  editor: "Editor",
  member: "Member",
  "connect-only": "Connect-Only",
};

// ─── Permission checkbox grid ─────────────────────────────────────────────────

function PermissionGrid({
  value,
  onChange,
  readOnly = false,
}: {
  value: number;
  onChange?: (v: number) => void;
  readOnly?: boolean;
}) {
  const toggle = (bit: number) => {
    if (readOnly || !onChange) return;
    onChange(value ^ bit);
  };

  return (
    <div className="grid grid-cols-1 gap-1">
      {PERMISSIONS.map((perm) => {
        const bit = PERM_BITS[perm];
        const checked = (value & bit) !== 0;
        const { label, description } = PERM_META[perm];
        return (
          <label
            key={perm}
            className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors"
            style={{
              background: checked ? "rgba(var(--t-accent-rgb, 99,102,241), 0.08)" : "transparent",
              cursor: readOnly ? "default" : "pointer",
            }}
            onMouseEnter={(e) => { if (!readOnly) (e.currentTarget as HTMLLabelElement).style.background = checked ? "rgba(var(--t-accent-rgb, 99,102,241), 0.12)" : "var(--t-bg-elevated)"; }}
            onMouseLeave={(e) => { if (!readOnly) (e.currentTarget as HTMLLabelElement).style.background = checked ? "rgba(var(--t-accent-rgb, 99,102,241), 0.08)" : "transparent"; }}
            onClick={() => toggle(bit)}
          >
            <div
              className="shrink-0 w-4 h-4 rounded flex items-center justify-center border transition-colors"
              style={{
                background: checked ? "var(--t-accent)" : "transparent",
                borderColor: checked ? "var(--t-accent)" : "var(--t-border)",
              }}
            >
              {checked && <Icon icon="lucide:check" width={10} className="text-white" />}
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium" style={{ color: "var(--t-text-primary)" }}>{label}</span>
              <span className="text-xs ml-2" style={{ color: "var(--t-text-dim)" }}>{description}</span>
            </div>
          </label>
        );
      })}
    </div>
  );
}

// ─── Role modal (create / edit) ───────────────────────────────────────────────

function RoleModal({
  teamId,
  role,
  onClose,
}: {
  teamId: string;
  role: CustomRole | null; // null = create new
  onClose: () => void;
}) {
  const { createCustomRole, updateCustomRole } = useTeamStore();
  const [name, setName] = useState(role?.name ?? "");
  const [permissions, setPermissions] = useState(role?.permissions ?? 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async () => {
    if (!name.trim()) { setError("Name is required"); return; }
    setSaving(true); setError("");
    try {
      if (role) {
        await updateCustomRole(teamId, role.id, { name: name.trim(), permissions });
      } else {
        await createCustomRole(teamId, name.trim(), permissions);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save role");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="flex flex-col rounded-2xl overflow-hidden"
        style={{
          width: "min(32rem, 94vw)",
          maxHeight: "min(44rem, 90vh)",
          background: "var(--t-bg-base)",
          border: "1px solid var(--t-border)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-b-[var(--t-border)] shrink-0">
          <span className="text-sm font-semibold" style={{ color: "var(--t-text-bright)" }}>
            {role ? "Edit role" : "New custom role"}
          </span>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: "var(--t-text-muted)" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-bright)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-muted)"; }}
          >
            <Icon icon="lucide:x" width={15} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Name */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest mb-2" style={{ color: "var(--t-text-dim)" }}>
              Role name
            </label>
            <input
              autoFocus
              type="text"
              placeholder="e.g. Read-only, Deployment, DevOps…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleSave(); }}
              className="w-full px-3 py-2 rounded-lg text-sm outline-none"
              style={{ background: "var(--t-bg-input)", border: "1px solid var(--t-border)", color: "var(--t-text-primary)" }}
              onFocus={(e) => { (e.currentTarget as HTMLInputElement).style.borderColor = "var(--t-accent)"; }}
              onBlur={(e) => { (e.currentTarget as HTMLInputElement).style.borderColor = "var(--t-border)"; }}
            />
          </div>

          {/* Permissions */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest mb-2" style={{ color: "var(--t-text-dim)" }}>
              Permissions
            </label>
            <PermissionGrid value={permissions} onChange={setPermissions} />
          </div>

          {error && <p className="text-xs px-1" style={{ color: "var(--t-status-error)" }}>{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-t-[var(--t-border)] shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm"
            style={{ background: "var(--t-bg-elevated)", color: "var(--t-text-muted)" }}
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving || !name.trim()}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white inline-flex items-center gap-2"
            style={{ background: "var(--t-accent)", opacity: saving || !name.trim() ? 0.7 : 1 }}
          >
            {saving && <Icon icon="lucide:loader-2" width={13} className="animate-spin" />}
            {role ? "Save changes" : "Create role"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Built-in role card (read-only) ──────────────────────────────────────────

function BuiltinRoleCard({ name, permissions }: { name: string; permissions: number }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ border: "1px solid var(--t-border)" }}
    >
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
        style={{ background: "var(--t-bg-elevated)" }}
        onClick={() => setExpanded((v) => !v)}
      >
        <Icon icon="lucide:lock" width={13} style={{ color: "var(--t-text-dim)" }} />
        <span className="flex-1 text-sm font-medium" style={{ color: "var(--t-text-primary)" }}>{name}</span>
        <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: "var(--t-bg-card)", color: "var(--t-text-dim)" }}>Built-in</span>
        <Icon icon={expanded ? "lucide:chevron-up" : "lucide:chevron-down"} width={13} style={{ color: "var(--t-text-dim)" }} />
      </button>
      {expanded && (
        <div className="px-4 py-3 border-t border-t-[var(--t-border)]">
          <PermissionGrid value={permissions} readOnly />
        </div>
      )}
    </div>
  );
}

// ─── Custom role card ─────────────────────────────────────────────────────────

function CustomRoleCard({
  teamId,
  role,
  canEdit,
}: {
  teamId: string;
  role: CustomRole;
  canEdit: boolean;
}) {
  const { deleteCustomRole } = useTeamStore();
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [editing, setEditing] = useState(false);

  const handleDelete = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true); setDeleteError("");
    try {
      await deleteCustomRole(teamId, role.id);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Failed to delete");
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <>
      {editing && (
        <RoleModal teamId={teamId} role={role} onClose={() => setEditing(false)} />
      )}
      <div
        className="rounded-xl overflow-hidden"
        style={{ border: "1px solid var(--t-border)" }}
      >
        <div className="flex items-center gap-3 px-4 py-3" style={{ background: "var(--t-bg-card)" }}>
          <button
            className="flex items-center gap-3 flex-1 text-left min-w-0"
            onClick={() => setExpanded((v) => !v)}
          >
            <Icon icon="lucide:shield" width={13} style={{ color: "var(--t-accent)" }} />
            <span className="flex-1 text-sm font-medium truncate" style={{ color: "var(--t-text-primary)" }}>{role.name}</span>
          </button>
          {canEdit && (
            <>
              <button
                onClick={() => setEditing(true)}
                className="p-1.5 rounded-lg transition-colors"
                style={{ color: "var(--t-text-dim)" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-primary)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-dim)"; }}
                title="Edit role"
              >
                <Icon icon="lucide:pencil" width={13} />
              </button>
              <button
                onClick={() => void handleDelete()}
                disabled={deleting}
                className="p-1.5 rounded-lg transition-colors"
                style={{ color: confirmDelete ? "var(--t-status-error)" : "var(--t-text-dim)" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-status-error)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = confirmDelete ? "var(--t-status-error)" : "var(--t-text-dim)"; }}
                onBlur={() => setConfirmDelete(false)}
                title={confirmDelete ? "Click again to confirm" : "Delete role"}
              >
                {deleting
                  ? <Icon icon="lucide:loader-2" width={13} className="animate-spin" />
                  : <Icon icon={confirmDelete ? "lucide:alert-triangle" : "lucide:trash-2"} width={13} />
                }
              </button>
            </>
          )}
          <button onClick={() => setExpanded((v) => !v)}>
            <Icon icon={expanded ? "lucide:chevron-up" : "lucide:chevron-down"} width={13} style={{ color: "var(--t-text-dim)" }} />
          </button>
        </div>
        {deleteError && (
          <p className="px-4 pb-2 text-xs" style={{ color: "var(--t-status-error)" }}>{deleteError}</p>
        )}
        {expanded && (
          <div className="px-4 py-3 border-t border-t-[var(--t-border)]">
            <PermissionGrid value={role.permissions} readOnly />
          </div>
        )}
      </div>
    </>
  );
}

// ─── Team roles panel ─────────────────────────────────────────────────────────

export function TeamRolesPanel({ teamId, myRole }: { teamId: string; myRole: string }) {
  const { customRolesByTeam, loadCustomRoles } = useTeamStore();
  const [creating, setCreating] = useState(false);

  const canEdit = myRole === "owner";
  const customRoles = customRolesByTeam[teamId] ?? [];

  useEffect(() => { loadCustomRoles(teamId).catch(() => {}); }, [teamId, loadCustomRoles]);

  return (
    <div className="space-y-6">
      {creating && (
        <RoleModal teamId={teamId} role={null} onClose={() => setCreating(false)} />
      )}

      {/* Built-in roles */}
      <div>
        <h4 className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: "var(--t-text-dim)" }}>
          Built-in roles
        </h4>
        <div className="space-y-2">
          {Object.entries(BUILTIN_LABELS).map(([key, label]) => (
            <BuiltinRoleCard key={key} name={label} permissions={BUILTIN_PERMISSIONS[key]} />
          ))}
        </div>
      </div>

      {/* Custom roles */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--t-text-dim)" }}>
            Custom roles
          </h4>
          {canEdit && (
            <button
              onClick={() => setCreating(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-colors"
              style={{ color: "var(--t-accent)", border: "1px solid var(--t-accent)", background: "transparent" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(var(--t-accent-rgb, 99,102,241), 0.1)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
            >
              <Icon icon="lucide:plus" width={11} />
              New role
            </button>
          )}
        </div>

        {customRoles.length === 0 ? (
          <div
            className="rounded-xl p-4 text-center"
            style={{ border: "1px dashed var(--t-border)" }}
          >
            <Icon icon="lucide:shield-off" width={22} className="mx-auto mb-2" style={{ color: "var(--t-text-dim)" }} />
            <p className="text-xs" style={{ color: "var(--t-text-dim)" }}>
              {canEdit ? "No custom roles yet. Create one to assign specific permissions." : "No custom roles defined for this team."}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {customRoles.map((role) => (
              <CustomRoleCard key={role.id} teamId={teamId} role={role} canEdit={canEdit} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main section ─────────────────────────────────────────────────────────────

export default function RolesSection() {
  const { teams, membersByTeam, loadTeams, loadMembers } = useTeamStore();
  const [myUserId, setMyUserId] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  useEffect(() => { getMyUserId().then((id) => { if (id) setMyUserId(id); }).catch(() => {}); }, []);
  useEffect(() => { loadTeams().catch(() => {}); }, [loadTeams]);

  // Auto-select first team
  useEffect(() => {
    if (!selectedTeamId && teams.length > 0) setSelectedTeamId(teams[0].id);
  }, [teams, selectedTeamId]);

  useEffect(() => {
    if (selectedTeamId && !membersByTeam[selectedTeamId]) {
      loadMembers(selectedTeamId).catch(() => {});
    }
  }, [selectedTeamId, membersByTeam, loadMembers]);

  // Teams with cloud (non-personal)
  const teamList = teams;

  const myRole = selectedTeamId
    ? (membersByTeam[selectedTeamId]?.find((m) => m.user_id === myUserId)?.role
      ?? teams.find((t) => t.id === selectedTeamId)?.role
      ?? "member")
    : "member";

  if (teamList.length === 0) {
    return (
      <div className="p-6 flex flex-col items-center justify-center h-full gap-3">
        <Icon icon="lucide:shield" width={32} style={{ color: "var(--t-text-dim)" }} />
        <p className="text-sm text-center" style={{ color: "var(--t-text-dim)" }}>
          No teams yet. Create a shared vault to start managing roles.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Team selector */}
      {teamList.length > 1 && (
        <div>
          <label className="block text-xs font-bold uppercase tracking-widest mb-2" style={{ color: "var(--t-text-dim)" }}>
            Team
          </label>
          <select
            value={selectedTeamId ?? ""}
            onChange={(e) => setSelectedTeamId(e.target.value)}
            className="px-3 py-2 rounded-lg text-sm outline-none"
            style={{ background: "var(--t-bg-input)", border: "1px solid var(--t-border)", color: "var(--t-text-primary)" }}
          >
            {teamList.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      )}

      {selectedTeamId && (
        <TeamRolesPanel teamId={selectedTeamId} myRole={myRole} />
      )}
    </div>
  );
}
