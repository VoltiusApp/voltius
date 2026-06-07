import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useVaultStore } from "@/stores/vaultStore";
import { useVaultContents } from "@/hooks/useVaultContents";
import { useUIContributions } from "@/hooks/useUIContributions";
import { useTeamStore } from "@/stores/teamStore";
import type { TeamMember, TeamRole } from "@/stores/teamStore";
import { searchUsers, getMyUserId, inviteByEmail, listPendingInvitations, revokePendingInvitation } from "@/services/teamService";
import type { PendingInvitation } from "@/services/teamService";
import { effectivePermissions, hasBuiltinRole, PERM_BITS } from "@/hooks/usePermission";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { useUIStore } from "@/stores/uiStore";
import { TeamRolesPanel } from "./RolesSection";
import BuySeatsModal from "@/components/settings/BuySeatsModal";
import { ContentCounts } from "@/components/shared/ContentCounts";
import { runTeamAction } from "@/services/teamActionFeedback";

import { markTeamVaultLoadedAfterLocalActivation } from "@/services/teamVaultActivation";
import { openBillingCheckout } from "@/services/billingCheckout";
import { useTeamVaultStateStore } from "@/stores/teamVaultStateStore";

// ─── Vault migration helpers ──────────────────────────────────────────────────

async function migrateVaultToTeam(
  vaultId: string,
  teamId: string,
): Promise<void> {
  const { useConnectionStore } = await import("@/stores/connectionStore");
  const { useIdentityStore } = await import("@/stores/identityStore");
  const { useKeyStore } = await import("@/stores/keyStore");
  const { useFolderStore } = await import("@/stores/folderStore");
  const { useSnippetStore } = await import("@/stores/snippetStore");
  const { useSnippetFolderStore } = await import("@/stores/snippetFolderStore");
  const { usePortForwardingStore } = await import("@/stores/portForwardingStore");
  const { saveTeamVaultObject } = await import("@/services/teamObjectPersistence");
  const { backfillExistingTeamVaultSecrets } = await import("@/services/teamVaultSecrets");

  const now = new Date().toISOString();

  // Clone entities from personal disk into team memory slices
  const conns = useConnectionStore.getState().connections
    .filter((c) => (c.vault_id ?? "personal") === vaultId)
    .map((c) => ({ ...c, vault_id: teamId, updated_at: now }));
  const identities = useIdentityStore.getState().identities
    .filter((i) => (i.vault_id ?? "personal") === vaultId)
    .map((i) => ({ ...i, vault_id: teamId, updated_at: now }));
  const keys = useKeyStore.getState().keys
    .filter((k) => (k.vault_id ?? "personal") === vaultId)
    .map((k) => ({ ...k, vault_id: teamId, updated_at: now }));
  const folders = useFolderStore.getState().folders
    .filter((f) => (f.vault_id ?? "personal") === vaultId)
    .map((f) => ({ ...f, vault_id: teamId, updated_at: now }));
  const snippets = useSnippetStore.getState().snippets
    .filter((s) => (s.vault_id ?? "personal") === vaultId)
    .map((s) => ({ ...s, vault_id: teamId, updated_at: now }));
  const snippetFolders = useSnippetFolderStore.getState().folders
    .filter((f) => (f.vault_id ?? "personal") === vaultId)
    .map((f) => ({ ...f, vault_id: teamId, updated_at: now }));
  const portRules = usePortForwardingStore.getState().rules
    .filter((r) => (r.vault_id ?? "personal") === vaultId)
    .map((r) => ({ ...r, vault_id: teamId, updated_at: now }));

  // Push each entity to the per-object API — this is what members read on fetch
  await Promise.all([
    ...conns.map((c) => saveTeamVaultObject(teamId, "connection", c)),
    ...identities.map((i) => saveTeamVaultObject(teamId, "identity", i)),
    ...keys.map((k) => saveTeamVaultObject(teamId, "key", k)),
    ...folders.map((f) => saveTeamVaultObject(teamId, "folder", f)),
    ...snippets.map((s) => saveTeamVaultObject(teamId, "snippet", s)),
    ...snippetFolders.map((f) => saveTeamVaultObject(teamId, "snippet_folder", f)),
    ...portRules.map((r) => saveTeamVaultObject(teamId, "port_forwarding_rule", r)),
  ]);

  // Populate in-memory stores so backfillExistingTeamVaultSecrets can resolve IDs,
  // and so the UI reflects the migration immediately
  useConnectionStore.getState().setTeamConnections(teamId, conns);
  useIdentityStore.getState().setTeamIdentities(teamId, identities);
  useKeyStore.getState().setTeamKeys(teamId, keys);
  useFolderStore.getState().setTeamFolders(teamId, folders);
  useSnippetStore.getState().setTeamSnippets(teamId, snippets);
  useSnippetFolderStore.getState().setTeamSnippetFolders(teamId, snippetFolders);
  usePortForwardingStore.getState().setTeamRules(teamId, portRules);

  // Upload secrets while they still exist in the local keychain
  await backfillExistingTeamVaultSecrets(teamId);

  // Delete originals from local disk
  const [connApi, identApi, keyApi, folderApi, snippetApi, pfApi] = await Promise.all([
    import("@/services/connections"),
    import("@/services/identities"),
    import("@/services/keys"),
    import("@/services/folders"),
    import("@/services/snippets"),
    import("@/services/portForwardingRules"),
  ]);
  await Promise.allSettled([
    ...conns.map((e) => connApi.deleteConnection(e.id)),
    ...identities.map((e) => identApi.deleteIdentity(e.id)),
    ...keys.map((e) => keyApi.deleteKey(e.id)),
    ...folders.map((e) => folderApi.deleteFolder(e.id)),
    ...snippets.map((e) => snippetApi.deleteSnippet(e.id)),
    ...snippetFolders.map((e) => snippetApi.deleteSnippetFolder(e.id)),
    ...portRules.map((e) => pfApi.deletePfRule(e.id)),
  ]);

  // Reload personal stores from disk to reflect deletions
  await Promise.all([
    useConnectionStore.getState().loadConnections(),
    useIdentityStore.getState().loadIdentities(),
    useKeyStore.getState().loadKeys(),
    useFolderStore.getState().loadFolders(),
    useSnippetStore.getState().loadSnippets(),
    useSnippetFolderStore.getState().loadFolders(),
    usePortForwardingStore.getState().loadRules(),
  ]);
}

// ─── Constants ────────────────────────────────────────────────────────────────

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

function RoleNameChip({ name, color: overrideColor, isBuiltin }: { name: string; color?: string | null; isBuiltin?: boolean }) {
  const m = ROLE_META[name];
  const color = overrideColor ?? m?.color ?? "var(--t-text-dim)";
  const bg = m?.bg ?? `${color}1a`;
  const builtin = isBuiltin ?? !!m;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full capitalize" style={{ color, background: bg }}>
      {builtin
        ? <Icon icon="lucide:lock" width={8} style={{ opacity: 0.6 }} />
        : <Icon icon="lucide:sparkles" width={8} style={{ opacity: 0.7 }} />
      }
      {m?.label ?? name}
    </span>
  );
}

function MemberRoleBadges({ member, roles }: { member: TeamMember; roles: TeamRole[] }) {
  const assigned = roles
    .filter((r) => member.role_ids.includes(r.id))
    .sort((a, b) => a.position - b.position);
  if (assigned.length === 0) return <span className="text-[10px]" style={{ color: "var(--t-text-dim)" }}>No role</span>;
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {assigned.map((r) => (
        <RoleNameChip key={r.id} name={r.name} color={r.color} isBuiltin={r.is_builtin} />
      ))}
    </div>
  );
}

// ─── Invite search bar ────────────────────────────────────────────────────────

interface SearchResult { user_id: string; display_name: string; public_key: string; }

function isValidEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function InviteBar({ teamId, existingIds, roles, canInvite, onMemberAdded }: {
  teamId: string;
  existingIds: Set<string>;
  roles: TeamRole[];
  canInvite: boolean;
  onMemberAdded?: () => void;
}) {
  const addMemberById = useTeamStore((s) => s.addMemberById);
  const assignMemberRole = useTeamStore((s) => s.assignMemberRole);
  const { usedSeats, totalSeats, load: reloadSubscription } = useSubscriptionStore();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const [sendingInvite, setSendingInvite] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  const [buySeatsFor, setBuySeatsFor] = useState<SearchResult | null | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isAtSeatLimit = totalSeats != null && usedSeats != null && usedSeats >= totalSeats;

  const inviteRoles = useMemo(
    () => roles.filter((r) => !(r.is_builtin && r.name === "owner")).sort((a, b) => a.position - b.position),
    [roles],
  );
  const defaultMemberRoleId = useMemo(() => inviteRoles.find((r) => r.is_builtin && r.name === "member")?.id, [inviteRoles]);

  useEffect(() => {
    if (defaultMemberRoleId && selectedRoleIds.length === 0) setSelectedRoleIds([defaultMemberRoleId]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultMemberRoleId]);

  const toggleRole = (roleId: string) =>
    setSelectedRoleIds((prev) => prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId]);

  const primaryRoleName = useMemo(
    () => inviteRoles.find((r) => selectedRoleIds.includes(r.id))?.name ?? "member",
    [selectedRoleIds, inviteRoles],
  );

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
    if (isAtSeatLimit) { setBuySeatsFor(user); setOpen(false); return; }
    setAdding(user.user_id);
    setError(""); setSuccess("");
    try {
      await runTeamAction({
        pending: `Adding ${user.display_name}...`,
        success: `${user.display_name} added`,
        run: () => addMemberById(teamId, user.user_id),
      });
      for (const roleId of selectedRoleIds) {
        await assignMemberRole(teamId, user.user_id, roleId).catch(() => {});
      }
      setQuery(""); setResults([]); setOpen(false);
      await reloadSubscription();
      onMemberAdded?.();
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      if ((e as { code?: number }).code === 402 || err.message.includes("402")) {
        setBuySeatsFor(user); setOpen(false);
      } else {
        setError(err.message);
      }
    } finally {
      setAdding(null);
    }
  };

  const handleEmailInvite = async () => {
    if (!isValidEmail(query)) return;
    if (isAtSeatLimit) { setBuySeatsFor(null); return; }
    setSendingInvite(true);
    setError(""); setSuccess("");
    try {
      const invitedEmail = query;
      const result = await runTeamAction({
        pending: `Inviting ${invitedEmail}...`,
        success: (r) => r.status === "invited" ? `Invitation sent to ${invitedEmail}` : `${invitedEmail} added`,
        run: () => inviteByEmail(teamId, invitedEmail, primaryRoleName),
      });
      setQuery(""); setResults([]); setOpen(false);
      setSuccess(result.status === "invited" ? `Invitation sent to ${invitedEmail}` : `${invitedEmail} added`);
      await reloadSubscription();
      onMemberAdded?.();
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      if ((e as { code?: number }).code === 402 || err.message.includes("402")) {
        setBuySeatsFor(null);
      } else {
        setError(err.message);
      }
    } finally {
      setSendingInvite(false);
    }
  };

  const showEmailInviteOption = open && results.length === 0 && !searching && isValidEmail(query);

  return (
    <>
      {buySeatsFor !== undefined && (
        <BuySeatsModal
          teamId={teamId}
          pendingUser={buySeatsFor ?? null}
          pendingRole={primaryRoleName}
          onClose={() => setBuySeatsFor(undefined)}
          onSuccess={async () => {
            setBuySeatsFor(undefined);
            await reloadSubscription();
            onMemberAdded?.();
          }}
        />
      )}
      <div className="mt-4">
        <h4 className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: "var(--t-text-dim)" }}>
          Invite member
        </h4>

        {/* Role chips */}
        {inviteRoles.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {inviteRoles.map((r) => {
              const isActive = selectedRoleIds.includes(r.id);
              const m = ROLE_META[r.name];
              const color = r.color ?? m?.color ?? "var(--t-accent)";
              const bg = m?.bg ?? `${color}1a`;
              return (
                <button
                  key={r.id}
                  onClick={() => toggleRole(r.id)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all"
                  style={{
                    background: isActive ? bg : "var(--t-bg-elevated)",
                    color: isActive ? color : "var(--t-text-dim)",
                    border: `1px solid ${isActive ? `${color}44` : "var(--t-border)"}`,
                  }}
                >
                  {isActive && <Icon icon="lucide:check" width={9} />}
                  {r.name}
                </button>
              );
            })}
          </div>
        )}

        <div className="relative">
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
              placeholder="Search or enter email…"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSuccess(""); }}
              onFocus={() => { if (results.length > 0 || showEmailInviteOption) setOpen(true); }}
              className="flex-1 bg-transparent outline-hidden text-sm"
              style={{ color: "var(--t-text-primary)" }}
            />
            {query && (
              <button onClick={() => { setQuery(""); setResults([]); setOpen(false); setSuccess(""); }}>
                <Icon icon="lucide:x" width={11} style={{ color: "var(--t-text-dim)" }} />
              </button>
            )}
          </div>

          {open && (results.length > 0 || showEmailInviteOption) && (
            <div
              ref={dropdownRef}
              className="absolute z-50 left-0 right-0 mt-1 rounded-xl overflow-hidden"
              style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)", boxShadow: "var(--t-elev-2)" }}
            >
              {results.map((user) => (
                <button
                  key={user.user_id}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors"
                  style={{ color: "var(--t-text-primary)" }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-elevated)")}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "transparent")}
                  disabled={!!adding}
                  onClick={() => void handleAdd(user)}
                >
                  <Avatar email={user.display_name} size={26} />
                  <span className="flex-1 text-sm truncate">{user.display_name}</span>
                  {adding === user.user_id
                    ? <Icon icon="lucide:loader-2" width={13} className="animate-spin shrink-0" style={{ color: "var(--t-text-dim)" }} />
                    : <span className="text-xs px-2 py-0.5 rounded-full font-medium shrink-0" style={{ background: "var(--t-accent)", color: "#fff" }}>
                        Add
                      </span>
                  }
                </button>
              ))}
              {showEmailInviteOption && (
                <button
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors border-t"
                  style={{ color: "var(--t-text-primary)", borderColor: "var(--t-border)" }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-elevated)")}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "transparent")}
                  disabled={sendingInvite}
                  onClick={() => void handleEmailInvite()}
                >
                  <Icon icon="lucide:mail" width={16} className="shrink-0" style={{ color: "var(--t-accent)" }} />
                  <span className="flex-1 text-sm">
                    Send invite to <span className="font-medium">{query}</span>
                  </span>
                  {sendingInvite
                    ? <Icon icon="lucide:loader-2" width={13} className="animate-spin shrink-0" style={{ color: "var(--t-text-dim)" }} />
                    : <span className="text-xs px-2 py-0.5 rounded-full font-medium shrink-0" style={{ background: "var(--t-accent)", color: "#fff" }}>
                        Invite →
                      </span>
                  }
                </button>
              )}
            </div>
          )}
        </div>
        {error && <p className="text-xs mt-1.5 px-1" style={{ color: "var(--t-status-error)" }}>{error}</p>}
        {success && <p className="text-xs mt-1.5 px-1" style={{ color: "var(--t-status-connected)" }}>{success}</p>}
      </div>
    </>
  );
}

// ─── Member row ───────────────────────────────────────────────────────────────

function MemberRow({ member, isMe, myMember, teamId, roles }: {
  member: TeamMember;
  isMe: boolean;
  myMember: TeamMember | undefined;
  teamId: string;
  roles: TeamRole[];
}) {
  const { assignMemberRole, removeMemberRole, removeMember } = useTeamStore();
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState("");

  const myPerms = myMember ? effectivePermissions(myMember, roles) : 0;
  const memberIsOwner = hasBuiltinRole(member, "owner", roles);
  const canChangeRole = (myPerms & PERM_BITS.MANAGE_MEMBERS) !== 0 && !memberIsOwner && !isMe;
  const canRemove = (myPerms & PERM_BITS.MANAGE_MEMBERS) !== 0 && !memberIsOwner && !isMe;

  const nonOwnerRoles = roles
    .filter((r) => !(r.is_builtin && r.name === "owner"))
    .sort((a, b) => a.position - b.position);

  const handleToggleRole = async (role: TeamRole) => {
    const hasRole = member.role_ids.includes(role.id);
    setBusy(true); setError("");
    try {
      if (hasRole) {
        await runTeamAction({
          pending: `Removing ${role.name} from ${member.display_name}...`,
          success: `${role.name} removed from ${member.display_name}`,
          run: () => removeMemberRole(teamId, member.user_id, role.id),
        });
      } else {
        await runTeamAction({
          pending: `Assigning ${role.name} to ${member.display_name}...`,
          success: `${role.name} assigned to ${member.display_name}`,
          run: () => assignMemberRole(teamId, member.user_id, role.id),
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    if (!confirmRemove) { setConfirmRemove(true); return; }
    setBusy(true); setError("");
    try {
      await runTeamAction({
        pending: `Removing ${member.display_name}...`,
        success: `${member.display_name} removed`,
        run: () => removeMember(teamId, member.user_id),
      });
    }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); setBusy(false); setConfirmRemove(false); }
  };

  const displayRoles = roles
    .filter((r) => member.role_ids.includes(r.id))
    .sort((a, b) => a.position - b.position);

  return (
    <div style={{ borderBottom: "1px solid var(--t-border)" }}>
      <div className="flex items-center gap-3 px-4 py-2.5">
        <Avatar email={member.display_name} size={30} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-medium truncate" style={{ color: "var(--t-text-primary)" }}>{member.display_name}</p>
            {isMe && <span className="text-[10px] px-1.5 py-0.5 rounded-sm" style={{ color: "var(--t-text-dim)", background: "var(--t-bg-elevated)" }}>you</span>}
          </div>
        </div>

        {canChangeRole ? (
          <div className="flex items-center gap-1 flex-wrap">
            {busy && <Icon icon="lucide:loader-2" width={11} className="animate-spin" style={{ color: "var(--t-text-dim)" }} />}
            {nonOwnerRoles.map((r) => {
              const hasRole = member.role_ids.includes(r.id);
              const m = ROLE_META[r.name];
              const color = r.color ?? m?.color ?? "var(--t-accent)";
              const bg = m?.bg ?? `${color}1a`;
              return (
                <button
                  key={r.id}
                  onClick={() => void handleToggleRole(r)}
                  disabled={busy}
                  className="text-[10px] px-2 py-0.5 rounded-full transition-all"
                  style={{
                    background: hasRole ? bg : "var(--t-bg-elevated)",
                    color: hasRole ? color : "var(--t-text-dim)",
                    border: `1px solid ${hasRole ? `${color}44` : "var(--t-border)"}`,
                  }}
                >
                  {r.name}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex items-center gap-1 flex-wrap">
            {displayRoles.length === 0
              ? <span className="text-[10px]" style={{ color: "var(--t-text-dim)" }}>No role</span>
              : displayRoles.map((r) => <RoleNameChip key={r.id} name={r.name} color={r.color} isBuiltin={r.is_builtin} />)
            }
          </div>
        )}

        {canRemove && (
          <button
            onClick={() => void handleRemove()}
            disabled={busy}
            className="p-1 rounded-sm transition-colors ml-1"
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

export function TeamVaultPanel({ teamId, myUserId }: { teamId: string; myUserId: string }) {
  const { membersByTeam, loadMembers, rolesByTeam, loadRoles } = useTeamStore();
  const members = membersByTeam[teamId] ?? [];
  const roles = rolesByTeam[teamId] ?? [];
  const myMember = members.find((m) => m.user_id === myUserId);
  const [pendingInvites, setPendingInvites] = useState<PendingInvitation[]>([]);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const myPerms = myMember ? effectivePermissions(myMember, roles) : 0;
  const canManage = (myPerms & PERM_BITS.MANAGE_MEMBERS) !== 0;
  const canInvite = (myPerms & PERM_BITS.INVITE_MEMBERS) !== 0;

  const reload = () => {
    loadMembers(teamId).catch(() => {});
    if (canManage) {
      listPendingInvitations(teamId).then(setPendingInvites).catch(() => {});
    }
  };

  useEffect(() => { loadMembers(teamId).catch(() => {}); }, [teamId, loadMembers]);
  useEffect(() => { loadRoles(teamId).catch(() => {}); }, [teamId, loadRoles]);
  useEffect(() => {
    if (canManage) {
      listPendingInvitations(teamId).then(setPendingInvites).catch(() => {});
    }
  }, [teamId, canManage]);

  const handleRevoke = async (invId: string) => {
    setRevokingId(invId);
    const invite = pendingInvites.find((i) => i.id === invId);
    try {
      await runTeamAction({
        pending: `Revoking invitation for ${invite?.display_name ?? "member"}...`,
        success: `Invitation revoked for ${invite?.display_name ?? "member"}`,
        run: () => revokePendingInvitation(teamId, invId),
      });
      setPendingInvites((prev) => prev.filter((i) => i.id !== invId));
    } catch {
      // toast already reports the failure
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs px-2 py-0.5 rounded-sm" style={{ background: "var(--t-bg-elevated)", color: "var(--t-text-dim)" }}>
          {members.length} member{members.length !== 1 ? "s" : ""}
        </span>
        {myMember && <MemberRoleBadges member={myMember} roles={roles} />}
      </div>

      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--t-border)" }}>
        {members.length === 0
          ? <p className="px-4 py-3 text-xs" style={{ color: "var(--t-text-dim)" }}>Loading…</p>
          : members.map((m) => (
            <MemberRow
              key={m.user_id}
              member={m}
              isMe={m.user_id === myUserId}
              myMember={myMember}
              teamId={teamId}
              roles={roles}
            />
          ))
        }
      </div>

      {pendingInvites.length > 0 && (
        <div className="mt-4">
          <h4 className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: "var(--t-text-dim)" }}>
            Pending invitations
          </h4>
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--t-border)" }}>
            {pendingInvites.map((inv) => (
              <div key={inv.id} className="flex items-center gap-3 px-4 py-2.5" style={{ borderTop: "1px solid var(--t-border)" }}>
                <Avatar email={inv.display_name} size={28} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate" style={{ color: "var(--t-text-primary)" }}>{inv.display_name}</p>
                </div>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ color: "var(--t-text-dim)", background: "var(--t-bg-elevated)" }}>
                  Pending
                </span>
                <RoleNameChip name={inv.role} isBuiltin={true} />
                <button
                  title="Revoke invitation"
                  disabled={revokingId === inv.id}
                  onClick={() => void handleRevoke(inv.id)}
                  className="ml-1 rounded-sm p-0.5 transition-opacity"
                  style={{ color: "var(--t-text-dim)", opacity: revokingId === inv.id ? 0.4 : 1 }}
                >
                  {revokingId === inv.id
                    ? <Icon icon="lucide:loader-2" width={13} className="animate-spin" />
                    : <Icon icon="lucide:x" width={13} />
                  }
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <InviteBar
        teamId={teamId}
        existingIds={new Set(members.map((m) => m.user_id))}
        roles={roles}
        canInvite={canInvite}
        onMemberAdded={reload}
      />
    </div>
  );
}

// ─── Team vault members summary (lightweight, links to Members tab) ───────────

function TeamMembersSummary({ teamId }: { teamId: string }) {
  const { membersByTeam, loadMembers, rolesByTeam, loadRoles } = useTeamStore();
  const setActiveNav = useUIStore((s) => s.setActiveNav);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
  const setHomeView = useUIStore((s) => s.setHomeView);

  const members = membersByTeam[teamId] ?? [];
  const roles = rolesByTeam[teamId] ?? [];

  useEffect(() => { loadMembers(teamId).catch(() => {}); }, [teamId, loadMembers]);
  useEffect(() => { loadRoles(teamId).catch(() => {}); }, [teamId, loadRoles]);

  const onlineCount = members.filter((m) => m.is_online).length;
  const preview = members.slice(0, 5);
  const overflow = members.length - preview.length;

  function goToMembers() {
    setSettingsOpen(false);
    setHomeView(false);
    setActiveNav("members");
  }

  return (
    <div className="space-y-4">
      {/* Member count summary */}
      <div
        className="rounded-xl p-4 flex items-center gap-4"
        style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)" }}
      >
        <div className="flex-1">
          <p className="text-sm font-semibold" style={{ color: "var(--t-text-primary)" }}>
            {members.length} member{members.length !== 1 ? "s" : ""}
          </p>
          {onlineCount > 0 && (
            <p className="text-xs mt-0.5" style={{ color: "var(--t-text-dim)" }}>
              {onlineCount} online now
            </p>
          )}
        </div>
        {/* Avatar stack */}
        <div className="flex items-center">
          {preview.map((m, i) => (
            <div
              key={m.user_id}
              title={m.display_name}
              style={{ marginLeft: i === 0 ? 0 : -8, zIndex: preview.length - i }}
              className="rounded-full border-2 border-(--t-bg-card)"
            >
              <Avatar email={m.display_name} size={24} />
            </div>
          ))}
          {overflow > 0 && (
            <div
              className="flex items-center justify-center text-[10px] font-semibold rounded-full shrink-0 border-2 border-(--t-bg-card)"
              style={{ marginLeft: -8, width: 24, height: 24, background: "var(--t-bg-elevated)", color: "var(--t-text-dim)" }}
            >
              +{overflow}
            </div>
          )}
        </div>
      </div>

      {/* Role breakdown */}
      {roles.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: "var(--t-text-dim)" }}>
            Roles
          </p>
          <div className="flex flex-wrap gap-2">
            {roles.filter((r) => !r.is_builtin || r.name !== "owner").map((r) => {
              const count = members.filter((m) => m.role_ids.includes(r.id)).length;
              if (!count) return null;
              const meta = ROLE_META[r.name];
              const color = r.color ?? meta?.color ?? avatarColor(r.name);
              return (
                <span
                  key={r.id}
                  className="text-[11px] font-medium px-2 py-0.5 rounded-full capitalize"
                  style={{ color, background: `${color}1a` }}
                >
                  {count}× {meta?.label ?? r.name}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* CTA */}
      <button
        onClick={goToMembers}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors"
        style={{
          background: "color-mix(in srgb, var(--t-accent) 10%, transparent)",
          color: "var(--t-accent)",
          border: "1px solid color-mix(in srgb, var(--t-accent) 30%, transparent)",
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "color-mix(in srgb, var(--t-accent) 18%, transparent)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "color-mix(in srgb, var(--t-accent) 10%, transparent)"; }}
      >
        <Icon icon="lucide:users" width={14} />
        Open in Members
        <Icon icon="lucide:arrow-right" width={13} />
      </button>
    </div>
  );
}

// ─── Private vault members panel ──────────────────────────────────────────────

function UpgradeToTeamsCTA() {
  const openCheckout = async () => {
    await openBillingCheckout("teams");
  };

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
      <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: "rgba(99,102,241,0.12)" }}>
        <Icon icon="lucide:users-round" width={22} style={{ color: "var(--t-accent)" }} />
      </div>
      <div>
        <p className="text-sm font-medium mb-1" style={{ color: "var(--t-text-primary)" }}>Team Vaults require a Teams plan</p>
        <p className="text-xs max-w-xs" style={{ color: "var(--t-text-dim)" }}>
          Invite members, assign roles, and share credentials securely with your team.
        </p>
      </div>
      <button
        onClick={() => void openCheckout()}
        className="px-4 py-2 rounded-lg text-sm font-medium text-white"
        style={{ background: "var(--t-accent)" }}
      >
        Upgrade to Teams →
      </button>
    </div>
  );
}

export function PrivateVaultMembersPanel({
  vaultId, vaultName, myUserId, onTeamCreated,
}: {
  vaultId: string; vaultName: string; myUserId: string; onTeamCreated: (teamId: string) => void;
}) {
  const { isTeams, accountMode } = useSubscriptionStore();
  const openCloudAuth = useUIStore((s) => s.openCloudAuth);
  const { createTeam, loadRoles, addMemberById, assignMemberRole } = useTeamStore();
  const { setVaultTeamId } = useVaultStore();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
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
      const team = await createTeam(vaultName);
      setVaultTeamId(vaultId, team.id);
      const { initTeamVaultKey } = await import("@/services/teamVaultSync");
      await initTeamVaultKey(team.id, []);
      await migrateVaultToTeam(vaultId, team.id);
      markTeamVaultLoadedAfterLocalActivation(team.id, useTeamVaultStateStore.getState());
      await addMemberById(team.id, user.user_id);
      await loadRoles(team.id);
      const memberRole = useTeamStore.getState().rolesByTeam[team.id]?.find(
        (r) => r.is_builtin && r.name === "member",
      );
      if (memberRole) {
        await assignMemberRole(team.id, user.user_id, memberRole.id);
      }
      setQuery(""); setResults([]); setOpen(false);
      onTeamCreated(team.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add member");
    } finally {
      setAdding(null);
    }
  };

  if (accountMode !== "server") {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
        <Icon icon="lucide:cloud" width={28} style={{ color: "var(--t-text-dim)" }} />
        <p className="text-sm" style={{ color: "var(--t-text-dim)" }}>
          Sign in to a cloud account to invite teammates to this vault.
        </p>
        <button
          onClick={() => openCloudAuth("signin")}
          className="px-3 py-1.5 rounded-lg text-xs font-medium text-white transition-opacity hover:opacity-90"
          style={{ background: "var(--t-accent)" }}
        >
          Sign in / Create account
        </button>
      </div>
    );
  }

  if (!isTeams) return <UpgradeToTeamsCTA />;

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
      <div className="rounded-xl overflow-hidden mb-4" style={{ border: "1px solid var(--t-border)" }}>
        <div className="flex items-center gap-3 px-4 py-2.5">
          <Avatar email={myUserId} size={30} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-medium" style={{ color: "var(--t-text-primary)" }}>You</p>
              <span className="text-[10px] px-1.5 py-0.5 rounded-sm" style={{ color: "var(--t-text-dim)", background: "var(--t-bg-elevated)" }}>you</span>
            </div>
          </div>
          <RoleNameChip name="owner" isBuiltin={true} />
        </div>
      </div>

      <h4 className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: "var(--t-text-dim)" }}>
        Invite member
      </h4>
      <div className="relative">
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
              className="flex-1 bg-transparent outline-hidden text-sm"
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
              style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)", boxShadow: "var(--t-elev-2)" }}
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
                    <Avatar email={user.display_name} size={26} />
                    <span className="flex-1 text-sm truncate">{user.display_name}</span>
                    {adding === user.user_id
                      ? <Icon icon="lucide:loader-2" width={13} className="animate-spin shrink-0" style={{ color: "var(--t-text-dim)" }} />
                      : <span className="text-xs px-2 py-0.5 rounded-full font-medium shrink-0" style={{ background: "var(--t-accent)", color: "#fff" }}>
                          Add as Member
                        </span>
                    }
                  </button>
                ))
              }
            </div>
          )}
      </div>
      {error && <p className="text-xs mt-1.5 px-1" style={{ color: "var(--t-status-error)" }}>{error}</p>}
    </div>
  );
}

// ─── Vault roles tab wrapper ──────────────────────────────────────────────────

function VaultRolesTab({ teamId, myUserId }: { teamId: string; myUserId: string }) {
  return <TeamRolesPanel teamId={teamId} myUserId={myUserId} />;
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
  const { renameVault, removeVault, setVaultTeamId } = useVaultStore();
  const { membersByTeam, teams, rolesByTeam } = useTeamStore();
  const counts = useVaultContents(detail.vaultId ?? undefined);
  const [name, setName] = useState(detail.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmMakePrivate, setConfirmMakePrivate] = useState(false);
  const [makingPrivate, setMakingPrivate] = useState(false);

  const isPersonal = detail.vaultId === "personal";
  const isTeam = !!detail.teamId;
  const canRename = detail.kind === "local";
  const canDelete = detail.kind === "local" && !isPersonal;
  const memberCount = detail.teamId ? (membersByTeam[detail.teamId]?.length ?? null) : null;
  const nonZeroCounts = counts.filter((c) => c.count > 0);

  const isOwner = (() => {
    if (!detail.teamId) return false;
    const myRoleIds = teams.find((t) => t.id === detail.teamId)?.role_ids ?? [];
    const roles = rolesByTeam[detail.teamId] ?? [];
    return myRoleIds.some((rid) => {
      const r = roles.find((role) => role.id === rid);
      return r?.is_builtin && r.name === "owner";
    });
  })();

  const canMakePrivate = isTeam && isOwner && detail.kind === "local" && detail.vaultId !== null;

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

  const handleMakePrivate = async () => {
    if (!confirmMakePrivate) { setConfirmMakePrivate(true); return; }
    if (!detail.vaultId || !detail.teamId || makingPrivate) return;
    setMakingPrivate(true);
    try {
      const { fetchTeamData } = await import("@/services/teamVaultSync");
      const { useConnectionStore } = await import("@/stores/connectionStore");
      const { useIdentityStore } = await import("@/stores/identityStore");
      const { useKeyStore } = await import("@/stores/keyStore");
      const { useFolderStore } = await import("@/stores/folderStore");
      const { useSnippetStore } = await import("@/stores/snippetStore");
      const { useSnippetFolderStore } = await import("@/stores/snippetFolderStore");
      const { usePortForwardingStore } = await import("@/stores/portForwardingStore");
      const connApi = await import("@/services/connections");
      const identApi = await import("@/services/identities");
      const keyApi = await import("@/services/keys");
      const folderApi = await import("@/services/folders");
      const snippetApi = await import("@/services/snippets");
      const pfApi = await import("@/services/portForwardingRules");
      const { fetchWithAuth, getServerUrl } = await import("@/services/sync");
      const { clearTeamKeyCache } = await import("@/services/teamVaultSync");
      const { useTeamVaultStateStore } = await import("@/stores/teamVaultStateStore");

      const vaultId = detail.vaultId!;
      const teamId = detail.teamId!;

      await fetchTeamData(teamId);

      const now = new Date().toISOString();

      // Move entities from team memory to local disk with personal vault_id
      const conns = (useConnectionStore.getState().teamConnections[teamId] ?? [])
        .map((c) => ({ ...c, vault_id: vaultId, updated_at: now }));
      const identities = (useIdentityStore.getState().teamIdentities[teamId] ?? [])
        .map((i) => ({ ...i, vault_id: vaultId, updated_at: now }));
      const keys = (useKeyStore.getState().teamKeys[teamId] ?? [])
        .map((k) => ({ ...k, vault_id: vaultId, updated_at: now }));
      const folders = (useFolderStore.getState().teamFolders[teamId] ?? [])
        .map((f) => ({ ...f, vault_id: vaultId, updated_at: now }));
      const snippets = (useSnippetStore.getState().teamSnippets[teamId] ?? [])
        .map((s) => ({ ...s, vault_id: vaultId, updated_at: now }));
      const snippetFolders = (useSnippetFolderStore.getState().teamSnippetFolders[teamId] ?? [])
        .map((f) => ({ ...f, vault_id: vaultId, updated_at: now }));
      const portRules = (usePortForwardingStore.getState().teamRules[teamId] ?? [])
        .filter((r) => !r.deleted_at || r.updated_at > r.deleted_at)
        .map((r) => ({ ...r, vault_id: vaultId, updated_at: now }));

      // Write to local disk
      await Promise.allSettled([
        ...conns.map((c) => connApi.saveConnection({ name: c.name, host: c.host, port: c.port, username: c.username, auth_type: c.auth_type, tags: c.tags, identity_id: c.identity_id, folder_id: c.folder_id, vault_id: vaultId })),
        ...identities.map((i) => identApi.saveIdentity({ name: i.name, username: i.username, key_id: i.key_id, tags: i.tags, folder_id: i.folder_id, vault_id: vaultId })),
        ...keys.map((k) => keyApi.saveKey({ name: k.name, key_type: k.key_type, tags: k.tags, folder_id: k.folder_id, vault_id: vaultId })),
        ...folders.map((f) => folderApi.saveFolder({ name: f.name, object_type: f.object_type, parent_folder_id: f.parent_folder_id, vault_id: vaultId })),
        ...snippets.map((s) => snippetApi.createSnippet({ name: s.name, content: s.content, description: s.description, tags: s.tags, folder_id: s.folder_id, favorite: s.favorite, only_for_connection_tags: s.only_for_connection_tags, only_for_distros: s.only_for_distros, vault_id: vaultId })),
        ...snippetFolders.map((f) => snippetApi.createSnippetFolder({ name: f.name, object_type: f.object_type, parent_folder_id: f.parent_folder_id, vault_id: vaultId })),
        ...portRules.map((r) => pfApi.createPfRule({ name: r.name, local_port: r.local_port, remote_port: r.remote_port, remote_host: r.remote_host, tunnel_type: r.tunnel_type, bind_host: r.bind_host, target_host: r.target_host, description: r.description, connection_ids: r.connection_ids, folder_id: r.folder_id, vault_id: vaultId })),
      ]);

      // Clear team memory
      useConnectionStore.getState().clearTeamConnections(teamId);
      useIdentityStore.getState().clearTeamIdentities(teamId);
      useKeyStore.getState().clearTeamKeys(teamId);
      useFolderStore.getState().clearTeamFolders(teamId);
      useSnippetStore.getState().clearTeamSnippets(teamId);
      useSnippetFolderStore.getState().clearTeamSnippetFolders(teamId);
      usePortForwardingStore.getState().clearTeamRules(teamId);

      // Sever the team link
      setVaultTeamId(vaultId, null);
      clearTeamKeyCache();
      useTeamVaultStateStore.getState().setStatus(teamId, "idle");

      // Delete team on server (cascades all team tables)
      const serverUrl = await getServerUrl();
      if (serverUrl) {
        await fetchWithAuth(`${serverUrl}/v1/teams/${teamId}`, { method: "DELETE" }).catch(() => {});
      }

      // Reload personal stores
      await Promise.all([
        useConnectionStore.getState().loadConnections(),
        useIdentityStore.getState().loadIdentities(),
        useKeyStore.getState().loadKeys(),
        useFolderStore.getState().loadFolders(),
        useSnippetStore.getState().loadSnippets(),
        useSnippetFolderStore.getState().loadFolders(),
        usePortForwardingStore.getState().loadRules(),
      ]);

      const { useNotificationStore } = await import("@/stores/notificationStore");
      const memberN = membersByTeam[teamId]?.length ?? 0;
      useNotificationStore.getState().addToast({
        pluginId: "system", pluginName: "Voltius", type: "toast",
        message: `Vault is now private. ${memberN > 1 ? `${memberN - 1} member${memberN - 1 !== 1 ? "s" : ""} lost access.` : ""}`,
        severity: "info", duration: 3000,
      });

      onBack();
    } catch (e) {
      console.error("Failed to make vault private:", e);
    } finally {
      setMakingPrivate(false);
      setConfirmMakePrivate(false);
    }
  };

  return (
    <div className="space-y-6">
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
              className="form-input flex-1 px-3 py-2 rounded-lg text-sm outline-hidden"
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

      <div>
        <label className="block text-xs font-bold uppercase tracking-widest mb-3" style={{ color: "var(--t-text-dim)" }}>
          Info
        </label>
        <div className="flex flex-wrap gap-3">
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

      {(canDelete || canMakePrivate) && (
        <div>
          <h4 className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: "var(--t-text-dim)" }}>
            Danger zone
          </h4>
          <div className="space-y-3">
            {canMakePrivate && (
              <div className="rounded-xl p-4 flex items-center justify-between gap-4" style={{ border: "1px solid rgba(245,158,11,0.35)" }}>
                <div>
                  <p className="text-sm font-medium mb-0.5" style={{ color: "var(--t-text-primary)" }}>Make private</p>
                  <p className="text-xs" style={{ color: "var(--t-text-dim)" }}>
                    {confirmMakePrivate
                      ? `Remove ${memberCount !== null && memberCount > 1 ? memberCount - 1 : "all"} member${(memberCount ?? 0) > 2 ? "s" : ""} and make private?`
                      : "Removes all members and converts this back to a personal vault."}
                  </p>
                </div>
                <button
                  onClick={() => void handleMakePrivate()}
                  onBlur={() => setConfirmMakePrivate(false)}
                  disabled={makingPrivate}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium shrink-0 transition-colors"
                  style={{
                    background: confirmMakePrivate ? "rgba(245,158,11,0.2)" : "transparent",
                    color: "#f59e0b",
                    border: "1px solid rgba(245,158,11,0.6)",
                    opacity: makingPrivate ? 0.6 : 1,
                  }}
                >
                  {makingPrivate ? "Converting…" : confirmMakePrivate ? "Confirm" : "Make private"}
                </button>
              </div>
            )}
            {canDelete && (
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
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Vault content counts (list row, skips zeros) ─────────────────────────────

function VaultContentCounts({ vaultId }: { vaultId: string }) {
  return <ContentCounts counts={useVaultContents(vaultId)} />;
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
  const { isPro, accountMode } = useSubscriptionStore();
  const openSettings = useUIStore((s) => s.openSettings);
  const openCloudAuth = useUIStore((s) => s.openCloudAuth);

  const [detail, setDetail] = useState<VaultDetail | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>("General");

  const [showCreate, setShowCreate] = useState(false);
  const [newVaultName, setNewVaultName] = useState("");

  useEffect(() => { getMyUserId().then((id) => { if (id) setMyUserId(id); }).catch(() => {}); }, []);
  useEffect(() => { loadTeams().catch(() => {}); }, [loadTeams]);

  const handleCreateVault = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVaultName.trim()) return;
    if (!isPro && vaults.length >= 1) {
      setShowCreate(false);
      setNewVaultName("");
      if (accountMode === "server") openSettings("account");
      else openCloudAuth("signin");
      return;
    }
    const vault = addVault(newVaultName.trim());
    setNewVaultName(""); setShowCreate(false);
    setDetail({ kind: "local", vaultId: vault.id, teamId: null, name: vault.name });
    setActiveTab("General");
  };

  const openDetail = (d: VaultDetail) => {
    setDetail(d);
    setActiveTab(d.teamId ? "Members" : "General");
  };

  if (detail) {
    const tabs: DetailTab[] = detail.teamId
      ? ["General", "Members", "Roles"]
      : ["General", "Members"];

    return (
      <div className="flex flex-col h-full">
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
              ? <TeamMembersSummary teamId={detail.teamId} />
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

  const linkedTeamIds = new Set(vaults.map((v) => v.teamId).filter(Boolean));
  const standaloneTeams = teams.filter((t) => !linkedTeamIds.has(t.id));
  const allItems: VaultItem[] = [
    ...vaults.map((v): VaultItem => ({ kind: "local", vault: v })),
    ...standaloneTeams.map((t): VaultItem => ({ kind: "cloud", teamId: t.id, name: t.name })),
  ];

  return (
    <div className="p-6 space-y-8">
      <div>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-xs font-bold uppercase tracking-widest text-(--t-text-dim)">Vaults</h3>
          <button
            onClick={() => {
              if (!isPro && vaults.length >= 1) {
                if (accountMode === "server") openSettings("account");
                else openCloudAuth("signin");
                return;
              }
              setShowCreate((v) => !v);
            }}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-colors"
            style={{ color: "var(--t-text-dim)", background: showCreate ? "var(--t-bg-elevated)" : "transparent", border: "1px solid var(--t-border)" }}
          >
            <Icon icon="lucide:plus" width={11} />
            New vault
          </button>
        </div>
        <p className="text-xs mb-4 text-(--t-text-muted)">Organize your connections, identities, and keys. Invite members to share a vault.</p>

        {showCreate && (
          <form onSubmit={handleCreateVault} className="flex gap-2 mb-4">
            <input
              autoFocus
              type="text"
              placeholder="Vault name…"
              value={newVaultName}
              onChange={(e) => setNewVaultName(e.target.value)}
              className="form-input flex-1 px-3 py-2 rounded-lg text-sm outline-hidden"
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
                <p className="flex-1 text-sm font-medium text-(--t-text-primary) truncate">{name}</p>

                {item.kind === "local" && hovered && (
                  <div className="flex items-center gap-2.5 shrink-0">
                    <VaultContentCounts vaultId={item.vault.id} />
                  </div>
                )}

                {item.kind === "local" && hovered && (
                  <_HoverSeparator vaultId={item.vault.id} />
                )}

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

      {vaultsContributions.length > 0 && (
        <div>
          <h3 className="text-xs font-bold uppercase tracking-widest mb-1 text-(--t-text-dim)">Import / Export</h3>
          <p className="text-xs mb-4 text-(--t-text-muted)">
            Back up or restore your hosts, identities, and SSH key metadata as JSON or CSV.
          </p>
          <div className="flex gap-3">
            {vaultsContributions.map((action) => (
              <button
                key={action.label}
                onClick={action.onClick}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors bg-(--t-bg-elevated) text-(--t-text-primary) border border-(--t-border-hover)"
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-bg-card-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "var(--t-bg-elevated)")}
              >
                {action.icon && <Icon icon={action.icon} width={15} className="text-(--t-accent)" />}
                {action.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function _HoverSeparator({ vaultId }: { vaultId: string }) {
  const hasNonZero = useVaultContents(vaultId).some((c) => c.count > 0);
  if (!hasNonZero) return null;
  return <div className="w-px h-3.5 shrink-0" style={{ background: "var(--t-border)" }} />;
}
