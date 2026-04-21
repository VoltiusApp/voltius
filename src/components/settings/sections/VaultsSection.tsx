import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useVaultStore } from "@/stores/vaultStore";
import { useVaultContents } from "@/hooks/useVaultContents";
import { useUIContributions } from "@/hooks/useUIContributions";
import { useTeamStore } from "@/stores/teamStore";
import type { CustomRole } from "@/stores/teamStore";
import { searchUsers, getMyUserId } from "@/services/teamService";
import { TeamRolesPanel } from "./RolesSection";

// ─── Constants ────────────────────────────────────────────────────────────────

const BUILTIN_INVITE_ROLES = ["manager", "editor", "member"] as const;

const ROLE_META: Record<string, { label: string; color: string; bg: string }> = {
  owner:          { label: "Owner",        color: "#a78bfa", bg: "rgba(167,139,250,0.12)" },
  manager:        { label: "Manager",      color: "#60a5fa", bg: "rgba(96,165,250,0.12)"  },
  editor:         { label: "Editor",       color: "#34d399", bg: "rgba(52,211,153,0.12)"  },
  member:         { label: "Member",       color: "var(--t-text-secondary)", bg: "var(--t-bg-elevated)" },
  "connect-only": { label: "Connect-Only", color: "#f59e0b", bg: "rgba(245,158,11,0.12)"  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  "#6366f1","#8b5cf6","#ec4899","#ef4444",
  "#f59e0b","#10b981","#3b82f6","#14b8a6",
];
function avatarColor(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function Avatar({ email, size = 28 }: { email: string; size?: number }) {
  return (
    <div
      className="rounded-full flex items-center justify-center shrink-0 font-bold select-none"
      style={{ width: size, height: size, background: avatarColor(email), color: "#fff", fontSize: size * 0.38 }}
    >
      {email[0]?.toUpperCase() ?? "?"}
    </div>
  );
}

function RoleBadge({ role, customRoleName }: { role: string; customRoleName?: string | null }) {
  if (customRoleName) {
    return (
      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full" style={{ color: "var(--t-accent)", background: "rgba(var(--t-accent-rgb, 99,102,241), 0.12)" }}>
        {customRoleName}
      </span>
    );
  }
  const m = ROLE_META[role] ?? ROLE_META.member;
  return (
    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full capitalize" style={{ color: m.color, background: m.bg }}>
      {m.label}
    </span>
  );
}

// ─── Invite search bar ────────────────────────────────────────────────────────

interface SearchResult { user_id: string; email: string; public_key: string; }

function InviteBar({ teamId, existingIds, myRole, customRoles }: {
  teamId: string;
  existingIds: Set<string>;
  myRole: string;
  customRoles: CustomRole[];
}) {
  const addMemberById = useTeamStore((s) => s.addMemberById);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<string>("member");
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const canInvite = myRole === "owner" || myRole === "manager";

  useEffect(() => {
    if (query.length < 2) { setResults([]); setOpen(false); return; }
    setSearching(true);
    const t = setTimeout(() => {
      searchUsers(query)
        .then((r) => { setResults(r.filter((u) => !existingIds.has(u.user_id))); setOpen(true); })
        .catch(() => {})
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(t);
  }, [query, existingIds]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (!inputRef.current?.contains(e.target as Node) && !dropdownRef.current?.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  if (!canInvite) return null;

  const handleAdd = async (user: SearchResult) => {
    setAdding(user.user_id);
    setError("");
    try {
      const isCustom = role.startsWith("custom:");
      const builtinRole = isCustom ? "member" : role;
      await addMemberById(teamId, user.user_id, builtinRole);
      if (isCustom) {
        const customRoleId = role.slice("custom:".length);
        const { assignCustomRole } = useTeamStore.getState();
        await assignCustomRole(teamId, user.user_id, customRoleId);
      }
      setQuery(""); setResults([]); setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add member");
    } finally {
      setAdding(null);
    }
  };

  const roleLabel = (r: string) => {
    if (r.startsWith("custom:")) {
      const id = r.slice("custom:".length);
      return customRoles.find((cr) => cr.id === id)?.name ?? "Custom";
    }
    return r.charAt(0).toUpperCase() + r.slice(1);
  };

  return (
    <div className="mt-4">
      <h4 className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: "var(--t-text-dim)" }}>
        Invite member
      </h4>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors"
            style={{ background: "var(--t-bg-input)", borderColor: open ? "var(--t-accent)" : "var(--t-border)" }}
          >
            {searching
              ? <Icon icon="lucide:loader-2" width={13} className="animate-spin shrink-0" style={{ color: "var(--t-text-dim)" }} />
              : <Icon icon="lucide:search" width={13} className="shrink-0" style={{ color: "var(--t-text-dim)" }} />
            }
            <input
              ref={inputRef}
              type="text"
              placeholder="Search by email…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => { if (results.length > 0) setOpen(true); }}
              className="flex-1 bg-transparent outline-none text-sm"
              style={{ color: "var(--t-text-primary)" }}
            />
            {query && (
              <button onClick={() => { setQuery(""); setResults([]); setOpen(false); }}>
                <Icon icon="lucide:x" width={11} style={{ color: "var(--t-text-dim)" }} />
              </button>
            )}
          </div>

          {open && (
            <div
              ref={dropdownRef}
              className="absolute z-50 left-0 right-0 mt-1 rounded-xl overflow-hidden"
              style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)", boxShadow: "0 8px 24px rgba(0,0,0,0.35)" }}
            >
              {results.length === 0
                ? <p className="px-4 py-3 text-xs" style={{ color: "var(--t-text-dim)" }}>No users found</p>
                : results.map((user) => (
                  <button
                    key={user.user_id}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors"
                    style={{ color: "var(--t-text-primary)" }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-elevated)")}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "transparent")}
                    disabled={!!adding}
                    onClick={() => void handleAdd(user)}
                  >
                    <Avatar email={user.email} size={26} />
                    <span className="flex-1 text-sm truncate">{user.email}</span>
                    {adding === user.user_id
                      ? <Icon icon="lucide:loader-2" width={13} className="animate-spin shrink-0" style={{ color: "var(--t-text-dim)" }} />
                      : <span className="text-xs px-2 py-0.5 rounded-full font-medium shrink-0" style={{ background: "var(--t-accent)", color: "#fff" }}>
                          Add as {roleLabel(role)}
                        </span>
                    }
                  </button>
                ))
              }
            </div>
          )}
        </div>

        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="px-2 py-2 rounded-lg text-xs outline-none shrink-0"
          style={{ background: "var(--t-bg-input)", border: "1px solid var(--t-border)", color: "var(--t-text-primary)" }}
        >
          {BUILTIN_INVITE_ROLES.map((r) => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
          {customRoles.length > 0 && (
            <optgroup label="Custom roles">
              {customRoles.map((cr) => (
                <option key={cr.id} value={`custom:${cr.id}`}>{cr.name}</option>
              ))}
            </optgroup>
          )}
        </select>
      </div>
      {error && <p className="text-xs mt-1.5 px-1" style={{ color: "var(--t-status-error)" }}>{error}</p>}
    </div>
  );
}

// ─── Member row ───────────────────────────────────────────────────────────────

function MemberRow({ member, isMe, myRole, teamId, customRoles }: {
  member: { user_id: string; email: string; role: string; custom_role_id: string | null; custom_role_name: string | null };
  isMe: boolean;
  myRole: string;
  teamId: string;
  customRoles: CustomRole[];
}) {
  const updateMemberRole = useTeamStore((s) => s.updateMemberRole);
  const assignCustomRole = useTeamStore((s) => s.assignCustomRole);
  const removeMember = useTeamStore((s) => s.removeMember);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState("");

  const canChangeRole = myRole === "owner" && member.role !== "owner" && !isMe;
  const canRemove = (myRole === "owner" || myRole === "manager") && member.role !== "owner" && !isMe;

  const currentRoleValue = member.custom_role_id ? `custom:${member.custom_role_id}` : member.role;

  const handleRoleChange = async (value: string) => {
    setBusy(true); setError("");
    try {
      if (value.startsWith("custom:")) {
        await assignCustomRole(teamId, member.user_id, value.slice("custom:".length));
      } else {
        await updateMemberRole(teamId, member.user_id, value);
      }
    }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  };

  const handleRemove = async () => {
    if (!confirmRemove) { setConfirmRemove(true); return; }
    setBusy(true); setError("");
    try { await removeMember(teamId, member.user_id); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); setBusy(false); setConfirmRemove(false); }
  };

  const roleColor = member.custom_role_id ? "var(--t-accent)" : (ROLE_META[member.role]?.color ?? "var(--t-text-secondary)");
  const roleBg   = member.custom_role_id ? "rgba(var(--t-accent-rgb, 99,102,241), 0.12)" : (ROLE_META[member.role]?.bg ?? "var(--t-bg-elevated)");

  return (
    <div style={{ borderBottom: "1px solid var(--t-border)" }}>
      <div className="flex items-center gap-3 px-4 py-2.5">
        <Avatar email={member.email} size={30} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-medium truncate" style={{ color: "var(--t-text-primary)" }}>{member.email}</p>
            {isMe && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: "var(--t-text-dim)", background: "var(--t-bg-elevated)" }}>you</span>}
          </div>
        </div>

        {canChangeRole ? (
          <div className="relative flex items-center gap-1">
            {busy && <Icon icon="lucide:loader-2" width={11} className="animate-spin" style={{ color: "var(--t-text-dim)" }} />}
            <select
              value={currentRoleValue}
              onChange={(e) => void handleRoleChange(e.target.value)}
              disabled={busy}
              className="text-xs rounded-full px-2 py-0.5 pr-5 outline-none appearance-none cursor-pointer"
              style={{ background: roleBg, color: roleColor, border: "none" }}
            >
              {["manager","editor","member"].map((r) => (
                <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
              ))}
              {customRoles.length > 0 && (
                <optgroup label="Custom">
                  {customRoles.map((cr) => (
                    <option key={cr.id} value={`custom:${cr.id}`}>{cr.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
            <Icon icon="lucide:chevron-down" width={9} className="absolute right-1.5 pointer-events-none" style={{ color: roleColor }} />
          </div>
        ) : (
          <RoleBadge role={member.role} customRoleName={member.custom_role_name} />
        )}

        {canRemove && (
          <button
            onClick={() => void handleRemove()}
            disabled={busy}
            className="p-1 rounded transition-colors ml-1"
            style={{ color: confirmRemove ? "var(--t-status-error)" : "var(--t-text-dim)" }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "var(--t-status-error)")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = confirmRemove ? "var(--t-status-error)" : "var(--t-text-dim)")}
            onBlur={() => setConfirmRemove(false)}
            title={confirmRemove ? "Click again to confirm" : "Remove from vault"}
          >
            {busy
              ? <Icon icon="lucide:loader-2" width={13} className="animate-spin" />
              : <Icon icon={confirmRemove ? "lucide:alert-triangle" : "lucide:user-minus"} width={13} />
            }
          </button>
        )}
      </div>
      {error && <p className="text-xs px-4 pb-1.5" style={{ color: "var(--t-status-error)" }}>{error}</p>}
    </div>
  );
}

// ─── Team vault members panel ─────────────────────────────────────────────────

function TeamVaultPanel({ teamId, myUserId }: { teamId: string; myUserId: string }) {
  const { membersByTeam, loadMembers, customRolesByTeam, loadCustomRoles } = useTeamStore();
  const members = membersByTeam[teamId] ?? [];
  const customRoles = customRolesByTeam[teamId] ?? [];
  const myMember = members.find((m) => m.user_id === myUserId);

  useEffect(() => { loadMembers(teamId).catch(() => {}); }, [teamId, loadMembers]);
  useEffect(() => { loadCustomRoles(teamId).catch(() => {}); }, [teamId, loadCustomRoles]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs px-2 py-0.5 rounded" style={{ background: "var(--t-bg-elevated)", color: "var(--t-text-dim)" }}>
          {members.length} member{members.length !== 1 ? "s" : ""}
        </span>
        <RoleBadge role={myMember?.role ?? "member"} customRoleName={myMember?.custom_role_name} />
      </div>

      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--t-border)" }}>
        {members.length === 0
          ? <p className="px-4 py-3 text-xs" style={{ color: "var(--t-text-dim)" }}>Loading…</p>
          : members.map((m) => (
            <MemberRow
              key={m.user_id}
              member={m}
              isMe={m.user_id === myUserId}
              myRole={myMember?.role ?? "member"}
              teamId={teamId}
              customRoles={customRoles}
            />
          ))
        }
      </div>

      <InviteBar
        teamId={teamId}
        existingIds={new Set(members.map((m) => m.user_id))}
        myRole={myMember?.role ?? "member"}
        customRoles={customRoles}
      />
    </div>
  );
}

// ─── Private vault members panel ──────────────────────────────────────────────
// Transparently enables sharing when the first member is added — no explicit
// "Enable sharing" step exposed to the user.

function PrivateVaultMembersPanel({
  vaultId, vaultName, myUserId, onTeamCreated,
}: {
  vaultId: string; vaultName: string; myUserId: string; onTeamCreated: (teamId: string) => void;
}) {
  const { createTeam } = useTeamStore();
  const { setVaultTeamId } = useVaultStore();
  const addMemberById = useTeamStore((s) => s.addMemberById);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<string>("member");
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.length < 2) { setResults([]); setOpen(false); return; }
    setSearching(true);
    const t = setTimeout(() => {
      searchUsers(query)
        .then((r) => { setResults(r); setOpen(true); })
        .catch(() => {})
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (!inputRef.current?.contains(e.target as Node) && !dropdownRef.current?.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const handleAdd = async (user: SearchResult) => {
    setAdding(user.user_id);
    setError("");
    try {
      // Transparently create the team on first invite
      const team = await createTeam(vaultName);
      setVaultTeamId(vaultId, team.id);
      const { initTeamVaultKey } = await import("@/services/teamVaultSync");
      await initTeamVaultKey(team.id, []);
      await addMemberById(team.id, user.user_id, role);
      setQuery(""); setResults([]); setOpen(false);
      onTeamCreated(team.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add member");
    } finally {
      setAdding(null);
    }
  };

  // No cloud account — can't invite
  if (!myUserId) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
        <Icon icon="lucide:users-round" width={28} style={{ color: "var(--t-text-dim)" }} />
        <p className="text-sm" style={{ color: "var(--t-text-dim)" }}>
          Sign in to a cloud account to invite teammates to this vault.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Current user row */}
      <div className="rounded-xl overflow-hidden mb-4" style={{ border: "1px solid var(--t-border)" }}>
        <div className="flex items-center gap-3 px-4 py-2.5">
          <Avatar email={myUserId} size={30} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-medium" style={{ color: "var(--t-text-primary)" }}>You</p>
              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: "var(--t-text-dim)", background: "var(--t-bg-elevated)" }}>you</span>
            </div>
          </div>
          <RoleBadge role="owner" />
        </div>
      </div>

      {/* Invite bar — sharing is enabled transparently on first add */}
      <h4 className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: "var(--t-text-dim)" }}>
        Invite member
      </h4>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors"
            style={{ background: "var(--t-bg-input)", borderColor: open ? "var(--t-accent)" : "var(--t-border)" }}
          >
            {searching
              ? <Icon icon="lucide:loader-2" width={13} className="animate-spin shrink-0" style={{ color: "var(--t-text-dim)" }} />
              : <Icon icon="lucide:search" width={13} className="shrink-0" style={{ color: "var(--t-text-dim)" }} />
            }
            <input
              ref={inputRef}
              type="text"
              placeholder="Search by email…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => { if (results.length > 0) setOpen(true); }}
              className="flex-1 bg-transparent outline-none text-sm"
              style={{ color: "var(--t-text-primary)" }}
            />
            {query && (
              <button onClick={() => { setQuery(""); setResults([]); setOpen(false); }}>
                <Icon icon="lucide:x" width={11} style={{ color: "var(--t-text-dim)" }} />
              </button>
            )}
          </div>

          {open && (
            <div
              ref={dropdownRef}
              className="absolute z-50 left-0 right-0 mt-1 rounded-xl overflow-hidden"
              style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)", boxShadow: "0 8px 24px rgba(0,0,0,0.35)" }}
            >
              {results.length === 0
                ? <p className="px-4 py-3 text-xs" style={{ color: "var(--t-text-dim)" }}>No users found</p>
                : results.map((user) => (
                  <button
                    key={user.user_id}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors"
                    style={{ color: "var(--t-text-primary)" }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-elevated)")}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "transparent")}
                    disabled={!!adding}
                    onClick={() => void handleAdd(user)}
                  >
                    <Avatar email={user.email} size={26} />
                    <span className="flex-1 text-sm truncate">{user.email}</span>
                    {adding === user.user_id
                      ? <Icon icon="lucide:loader-2" width={13} className="animate-spin shrink-0" style={{ color: "var(--t-text-dim)" }} />
                      : <span className="text-xs px-2 py-0.5 rounded-full font-medium shrink-0" style={{ background: "var(--t-accent)", color: "#fff" }}>
                          Add as {role.charAt(0).toUpperCase() + role.slice(1)}
                        </span>
                    }
                  </button>
                ))
              }
            </div>
          )}
        </div>

        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="px-2 py-2 rounded-lg text-xs outline-none shrink-0"
          style={{ background: "var(--t-bg-input)", border: "1px solid var(--t-border)", color: "var(--t-text-primary)" }}
        >
          {BUILTIN_INVITE_ROLES.map((r) => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
        </select>
      </div>
      {error && <p className="text-xs mt-1.5 px-1" style={{ color: "var(--t-status-error)" }}>{error}</p>}
    </div>
  );
}

// ─── Vault roles tab wrapper ──────────────────────────────────────────────────

function VaultRolesTab({ teamId, myUserId }: { teamId: string; myUserId: string }) {
  const { membersByTeam, loadMembers } = useTeamStore();
  const members = membersByTeam[teamId] ?? [];

  useEffect(() => {
    if (!membersByTeam[teamId]) loadMembers(teamId).catch(() => {});
  }, [teamId, membersByTeam, loadMembers]);

  const myRole = members.find((m) => m.user_id === myUserId)?.role ?? "member";
  return <TeamRolesPanel teamId={teamId} myRole={myRole} />;
}

// ─── Vault general tab ────────────────────────────────────────────────────────

function VaultGeneralTab({
  detail,
  onBack,
  onRenamed,
}: {
  detail: VaultDetail;
  onBack: () => void;
  onRenamed: (name: string) => void;
}) {
  const { renameVault, removeVault } = useVaultStore();
  const { membersByTeam } = useTeamStore();
  const counts = useVaultContents(detail.vaultId ?? undefined);
  const [name, setName] = useState(detail.name);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isPersonal = detail.vaultId === "personal";
  const isTeam = !!detail.teamId;
  const canRename = detail.kind === "local";
  const canDelete = detail.kind === "local" && !isPersonal;
  const memberCount = detail.teamId ? (membersByTeam[detail.teamId]?.length ?? null) : null;
  const nonZeroCounts = counts.filter((c) => c.count > 0);

  const handleRename = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed === detail.name) return;
    renameVault(detail.vaultId!, trimmed);
    onRenamed(trimmed);
  };

  const handleDelete = () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    removeVault(detail.vaultId!);
    onBack();
  };

  return (
    <div className="space-y-6">
      {/* Name */}
      <div>
        <label className="block text-xs font-bold uppercase tracking-widest mb-2" style={{ color: "var(--t-text-dim)" }}>
          Vault name
        </label>
        {canRename ? (
          <form onSubmit={handleRename} className="flex gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex-1 px-3 py-2 rounded-lg text-sm outline-none"
              style={{ background: "var(--t-bg-input)", border: "1px solid var(--t-border)", color: "var(--t-text-primary)" }}
              onFocus={(e) => { (e.currentTarget as HTMLInputElement).style.borderColor = "var(--t-accent)"; }}
              onBlur={(e) => { (e.currentTarget as HTMLInputElement).style.borderColor = "var(--t-border)"; }}
            />
            <button
              type="submit"
              disabled={!name.trim() || name.trim() === detail.name}
              className="px-3 py-2 rounded-lg text-sm font-medium text-white shrink-0"
              style={{ background: "var(--t-accent)", opacity: !name.trim() || name.trim() === detail.name ? 0.5 : 1 }}
            >
              Save
            </button>
          </form>
        ) : (
          <p className="text-sm" style={{ color: "var(--t-text-primary)" }}>{detail.name}</p>
        )}
      </div>

      {/* Info row */}
      <div>
        <label className="block text-xs font-bold uppercase tracking-widest mb-3" style={{ color: "var(--t-text-dim)" }}>
          Info
        </label>
        <div className="flex flex-wrap gap-3">
          {/* Type badge */}
          <div
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs"
            style={{ background: "var(--t-bg-elevated)", border: "1px solid var(--t-border)", color: "var(--t-text-secondary)" }}
          >
            <Icon icon={isTeam ? "lucide:users-round" : "lucide:user-round"} width={12} />
            {isTeam
              ? `Team · ${memberCount !== null ? `${memberCount} member${memberCount !== 1 ? "s" : ""}` : "…"}`
              : "Private"
            }
          </div>

          {/* Content counts — non-zero only */}
          {nonZeroCounts.map(({ icon, count }) => (
            <div
              key={icon}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs"
              style={{ background: "var(--t-bg-elevated)", border: "1px solid var(--t-border)", color: "var(--t-text-secondary)" }}
            >
              <Icon icon={icon} width={12} />
              {count}
            </div>
          ))}

          {/* Cloud-only note */}
          {detail.kind === "cloud" && (
            <div
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs"
              style={{ background: "var(--t-bg-elevated)", border: "1px solid var(--t-border)", color: "var(--t-text-dim)" }}
            >
              <Icon icon="lucide:cloud" width={12} />
              Cloud only
            </div>
          )}
        </div>

        {detail.kind === "cloud" && (
          <p className="text-xs mt-3" style={{ color: "var(--t-text-dim)" }}>
            This team exists only in the cloud and isn't linked to a local vault. Members and roles are still fully managed from the tabs above.
          </p>
        )}
      </div>

      {/* Danger zone */}
      {canDelete && (
        <div>
          <h4 className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: "var(--t-text-dim)" }}>
            Danger zone
          </h4>
          <div className="rounded-xl p-4 flex items-center justify-between gap-4" style={{ border: "1px solid rgba(var(--t-status-error-rgb, 239,68,68), 0.3)" }}>
            <div>
              <p className="text-sm font-medium mb-0.5" style={{ color: "var(--t-text-primary)" }}>Delete vault</p>
              <p className="text-xs" style={{ color: "var(--t-text-dim)" }}>
                {confirmDelete ? "Are you sure? This cannot be undone." : "Permanently removes this vault and all its contents."}
              </p>
            </div>
            <button
              onClick={handleDelete}
              onBlur={() => setConfirmDelete(false)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium shrink-0 transition-colors"
              style={{
                background: confirmDelete ? "var(--t-status-error)" : "transparent",
                color: confirmDelete ? "#fff" : "var(--t-status-error)",
                border: "1px solid var(--t-status-error)",
              }}
            >
              {confirmDelete ? "Confirm delete" : "Delete vault"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Vault content counts (list row, skips zeros) ─────────────────────────────

function VaultContentCounts({ vaultId }: { vaultId: string }) {
  const counts = useVaultContents(vaultId).filter((c) => c.count > 0);
  if (counts.length === 0) return null;
  return (
    <>
      {counts.map(({ icon, count }) => (
        <span key={icon} className="flex items-center gap-1">
          <Icon icon={icon} width={12} style={{ color: "var(--t-text-dim)" }} />
          <span className="text-xs" style={{ color: "var(--t-text-dim)" }}>{count}</span>
        </span>
      ))}
    </>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

type VaultItem =
  | { kind: "local"; vault: import("@/stores/vaultStore").Vault }
  | { kind: "cloud"; teamId: string; name: string };

type DetailTab = "General" | "Members" | "Roles";

interface VaultDetail {
  kind: "local" | "cloud";
  vaultId: string | null;
  teamId: string | null;
  name: string;
}

// ─── Main section ─────────────────────────────────────────────────────────────

export default function VaultsSection() {
  const { vaults, addVault } = useVaultStore();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const vaultsContributions = useUIContributions("settings.vaults");

  const { teams, loadTeams } = useTeamStore();
  const [myUserId, setMyUserId] = useState("");

  const [detail, setDetail] = useState<VaultDetail | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>("General");

  const [showCreate, setShowCreate] = useState(false);
  const [newVaultName, setNewVaultName] = useState("");

  useEffect(() => { getMyUserId().then((id) => { if (id) setMyUserId(id); }).catch(() => {}); }, []);
  useEffect(() => { loadTeams().catch(() => {}); }, [loadTeams]);

  const handleCreateVault = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVaultName.trim()) return;
    const vault = addVault(newVaultName.trim());
    setNewVaultName(""); setShowCreate(false);
    // Auto-open the new vault's detail page
    setDetail({ kind: "local", vaultId: vault.id, teamId: null, name: vault.name });
    setActiveTab("General");
  };

  const openDetail = (d: VaultDetail) => {
    setDetail(d);
    // Default to Members for team vaults, General for private
    setActiveTab(d.teamId ? "Members" : "General");
  };

  // ── Vault detail sub-page ─────────────────────────────────────────────────
  if (detail) {
    const tabs: DetailTab[] = detail.teamId
      ? ["General", "Members", "Roles"]
      : ["General", "Members"];

    return (
      <div className="flex flex-col h-full">
        {/* Breadcrumb */}
        <div className="flex items-center gap-3 px-6 py-4 shrink-0" style={{ borderBottom: "1px solid var(--t-border)" }}>
          <button
            onClick={() => setDetail(null)}
            className="flex items-center gap-1.5 text-xs transition-colors"
            style={{ color: "var(--t-text-dim)" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-primary)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-dim)"; }}
          >
            <Icon icon="lucide:chevron-left" width={14} />
            Vaults
          </button>
          <Icon icon="lucide:chevron-right" width={12} style={{ color: "var(--t-text-dim)" }} />
          <span className="text-xs font-medium" style={{ color: "var(--t-text-primary)" }}>{detail.name}</span>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-6 pt-3 shrink-0" style={{ borderBottom: "1px solid var(--t-border)" }}>
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="px-3 pb-2.5 text-xs font-medium transition-colors"
              style={{
                color: activeTab === tab ? "var(--t-text-primary)" : "var(--t-text-dim)",
                borderBottom: activeTab === tab ? "2px solid var(--t-accent)" : "2px solid transparent",
                marginBottom: "-1px",
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === "General" && (
            <VaultGeneralTab
              detail={detail}
              onBack={() => setDetail(null)}
              onRenamed={(name) => setDetail((d) => d ? { ...d, name } : null)}
            />
          )}
          {activeTab === "Members" && (
            detail.teamId
              ? <TeamVaultPanel teamId={detail.teamId} myUserId={myUserId} />
              : <PrivateVaultMembersPanel
                  vaultId={detail.vaultId!}
                  vaultName={detail.name}
                  myUserId={myUserId}
                  onTeamCreated={(teamId) => {
                    setDetail((d) => d ? { ...d, teamId } : null);
                  }}
                />
          )}
          {activeTab === "Roles" && detail.teamId && (
            <VaultRolesTab teamId={detail.teamId} myUserId={myUserId} />
          )}
        </div>
      </div>
    );
  }

  // Build unified list
  const linkedTeamIds = new Set(vaults.map((v) => v.teamId).filter(Boolean));
  const standaloneTeams = teams.filter((t) => !linkedTeamIds.has(t.id));
  const allItems: VaultItem[] = [
    ...vaults.map((v): VaultItem => ({ kind: "local", vault: v })),
    ...standaloneTeams.map((t): VaultItem => ({ kind: "cloud", teamId: t.id, name: t.name })),
  ];

  // ── Main vault list ───────────────────────────────────────────────────────
  return (
    <div className="p-6 space-y-8">

      <div>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--t-text-dim)]">Vaults</h3>
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-colors"
            style={{ color: "var(--t-text-dim)", background: showCreate ? "var(--t-bg-elevated)" : "transparent", border: "1px solid var(--t-border)" }}
          >
            <Icon icon="lucide:plus" width={11} />
            New vault
          </button>
        </div>
        <p className="text-xs mb-4 text-[var(--t-text-muted)]">Organize your connections, identities, and keys. Invite members to share a vault.</p>

        {showCreate && (
          <form onSubmit={handleCreateVault} className="flex gap-2 mb-4">
            <input
              autoFocus
              type="text"
              placeholder="Vault name…"
              value={newVaultName}
              onChange={(e) => setNewVaultName(e.target.value)}
              className="flex-1 px-3 py-2 rounded-lg text-sm outline-none"
              style={{ background: "var(--t-bg-input)", border: "1px solid var(--t-border)", color: "var(--t-text-primary)" }}
              onFocus={(e) => ((e.currentTarget as HTMLInputElement).style.borderColor = "var(--t-accent)")}
              onBlur={(e) => ((e.currentTarget as HTMLInputElement).style.borderColor = "var(--t-border)")}
            />
            <button
              type="submit"
              disabled={!newVaultName.trim()}
              className="px-3 py-2 rounded-lg text-sm font-medium text-white"
              style={{ background: "var(--t-accent)", opacity: !newVaultName.trim() ? 0.6 : 1 }}
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => { setShowCreate(false); setNewVaultName(""); }}
              className="px-3 py-2 rounded-lg text-sm"
              style={{ background: "var(--t-bg-elevated)", color: "var(--t-text-muted)" }}
            >
              Cancel
            </button>
          </form>
        )}

        <div className="space-y-2">
          {allItems.map((item) => {
            const id = item.kind === "local" ? item.vault.id : item.teamId;
            const name = item.kind === "local" ? item.vault.name : item.name;
            const teamId = item.kind === "local" ? (item.vault.teamId ?? null) : item.teamId;
            const isTeam = !!teamId;
            const hovered = hoveredId === id;

            return (
              <div
                key={id}
                className="flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer transition-all"
                style={{
                  background: "var(--t-bg-elevated)",
                  border: `1.5px solid ${hovered ? "var(--t-border-hover)" : "var(--t-border)"}`,
                }}
                onMouseEnter={() => setHoveredId(id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() => openDetail({
                  kind: item.kind,
                  vaultId: item.kind === "local" ? item.vault.id : null,
                  teamId,
                  name,
                })}
              >
                <Icon icon="lucide:vault" width={16} className="shrink-0" style={{ color: "var(--t-text-muted)" }} />

                <p className="flex-1 text-sm font-medium text-[var(--t-text-primary)] truncate">{name}</p>

                {/* Content counts on hover — local vaults only, zeros skipped */}
                {item.kind === "local" && hovered && (
                  <div className="flex items-center gap-2.5 shrink-0">
                    <VaultContentCounts vaultId={item.vault.id} />
                  </div>
                )}

                {/* Separator — only if there are counts to show */}
                {item.kind === "local" && hovered && (
                  <_HoverSeparator vaultId={item.vault.id} />
                )}

                {/* Privacy badge */}
                <div className="flex items-center gap-1 shrink-0" style={{ color: "var(--t-text-dim)" }}>
                  <Icon icon={isTeam ? "lucide:users-round" : "lucide:user-round"} width={12} />
                  <span className="text-xs">{isTeam ? "Team" : "Only you"}</span>
                </div>

                <Icon icon="lucide:chevron-right" width={13} className="shrink-0" style={{ color: "var(--t-text-dim)" }} />
              </div>
            );
          })}
        </div>
      </div>

      {/* Import / Export */}
      {vaultsContributions.length > 0 && (
        <div>
          <h3 className="text-xs font-bold uppercase tracking-widest mb-1 text-[var(--t-text-dim)]">Import / Export</h3>
          <p className="text-xs mb-4 text-[var(--t-text-muted)]">
            Back up or restore your hosts, identities, and SSH key metadata as JSON or CSV.
          </p>
          <div className="flex gap-3">
            {vaultsContributions.map((action) => (
              <button
                key={action.label}
                onClick={action.onClick}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors bg-[var(--t-bg-elevated)] text-[var(--t-text-primary)] border border-[var(--t-border-hover)]"
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-bg-card-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "var(--t-bg-elevated)")}
              >
                {action.icon && <Icon icon={action.icon} width={15} className="text-[var(--t-accent)]" />}
                {action.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Separator only renders when there are non-zero counts to separate from the badge
function _HoverSeparator({ vaultId }: { vaultId: string }) {
  const hasNonZero = useVaultContents(vaultId).some((c) => c.count > 0);
  if (!hasNonZero) return null;
  return <div className="w-px h-3.5 shrink-0" style={{ background: "var(--t-border)" }} />;
}
