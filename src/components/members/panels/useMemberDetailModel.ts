import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTeamStore } from "@/stores/teamStore";
import type { TeamRole } from "@/stores/teamStore";
import { useHistoryStore, type HistoryEntry } from "@/stores/historyStore";
import { runTeamAction } from "@/services/teamActionFeedback";
import { readOnlyReasonText, roleLabel, rolesGranting } from "@/components/members/roleChips";
import { roleChipBlockReason } from "@/components/members/panels/MemberRoleChips";
import { useBusinessLock } from "@/hooks/useBusinessLock";
import { useAutosave, type SaveState } from "@/hooks/useAutosave";
import { isOwnerRole } from "@/components/vault-share/vaultShareModel";
import type { DepartMode } from "@/services/teamOffboarding";
import {
  PERM_BITS, PERM_META, PERMISSION_GROUPS, effectivePermissions, dropsConnectSource,
  memberReadOnly, overrideRowLocked, isEditablePermission, type Permission,
} from "@/services/permissions";
import { rotateTeamKeyNow } from "@/services/vaultKeyActions";
import { losesVaultKey, type MemberDraft } from "@/services/permissionPreview";
import { getServerCapability } from "@/services/serverCapabilities";
import {
  overrideStateOf, applyOverrideState, type OverrideState, type PermissionOverrideRowProps,
} from "./PermissionOverrideRow";
import { memberLabel } from "@/services/memberLabel";
import { memberOwnership, type MemberOwnership } from "@/services/teamOwnership";
import { useOwnershipContext } from "@/hooks/useOwnershipContext";
import { useHeldPermissionBits } from "@/hooks/usePermission";
import { usePreviewActive } from "@/hooks/previewScope";
import { useGreyedUnless } from "@/hooks/useGreyedUnless";
import { whenWritable } from "@/services/previewGuard";
import type { MemberDetailPanelProps } from "./MemberDetailPanel";

export type OverrideRowModel = Omit<PermissionOverrideRowProps, "onChange" | "label" | "note">;

interface Confirm {
  confirm(): void;
  cancel(): void;
}

export interface MemberDetailModel {
  ownership: MemberOwnership;
  locked: boolean;
  readOnly: ReturnType<typeof memberReadOnly>;
  name: {
    value: string; setValue(v: string): void; commit(): void; revert(): void;
    saveState: SaveState; readOnly: boolean; title?: string; error: string;
  };
  roles: {
    list: TeamRole[]; showOwner: boolean; readOnlyReason: string | null; busyRoleId: string | null; flashRoleId: string | null;
    disabledReason(role: TeamRole): string | null; toggle(role: TeamRole): void; create(): void;
  };
  overrides: {
    visible: boolean; lockedEmpty: boolean; hasOverrides: boolean; rows: OverrideRowModel[];
    setState(p: Permission, next: OverrideState): void; clear?: () => Promise<void> | undefined;
  };
  primaryOwner: { shown: boolean; isPrimary: boolean; billingEnabled: boolean; make?: () => void };
  remove: { label: DepartMode; disabled: boolean; title?: string; leaveBlocked: boolean; open(): void };
  error: string | null;
  dialogs: {
    ownerRole: (Confirm & { kind: "grant" | "revoke" }) | null;
    primary: Confirm | null;
    revokeKey: Confirm | null;
    offboarding: { mode: DepartMode; close(): void; done(): void } | null;
    roleModal: { close(): void } | null;
  };
}

export function groupOverrideRows(rows: OverrideRowModel[], keep: (p: Permission) => boolean = () => true) {
  const byPermission = new Map(rows.map((r) => [r.permission, r]));
  return PERMISSION_GROUPS
    .map((g) => ({
      key: g.key,
      rows: g.permissions.flatMap((p) => {
        const row = byPermission.get(p);
        return row && keep(p) ? [row] : [];
      }),
    }))
    .filter((g) => g.rows.length > 0);
}

export function useMemberDetailModel({
  member, isMe, teamId, teamRoles, canManageMembers, canNameMembers, isTargetOwner, viewer, onUpdated,
}: Omit<MemberDetailPanelProps, "onClose">): MemberDetailModel {
  const { t } = useTranslation();
  const push = useHistoryStore((s) => s.push);
  const { locked } = useBusinessLock(teamId);
  const previewing = usePreviewActive() !== null;
  const greyedUnless = useGreyedUnless();

  const setStoredName = useTeamStore((s) => s.setMemberName);
  const [draftName, setDraftName] = useState(member.member_name ?? "");
  // A save landing mid-typing must not eat the trailing space the user is still typing past.
  useEffect(() => setDraftName((d) => (d.trim() === (member.member_name ?? "") ? d : member.member_name ?? "")), [member.member_name]);
  const [nameError, setNameError] = useState("");

  const commitName = async () => {
    const next = draftName.trim() || null;
    if (next === (member.member_name ?? null)) return;
    setNameError("");
    try {
      await setStoredName(teamId, member.user_id, next);
      onUpdated();
    } catch (e) {
      setNameError(e instanceof Error ? e.message : String(e));
      setDraftName(member.member_name ?? "");
    }
  };

  const { schedule, markDirty, flush, saveState } = useAutosave({ onSave: commitName });
  // Must precede the schedule effect: unmount cleanups run in order, and schedule's cancels the timer.
  useEffect(() => flush, [flush]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => schedule(), [draftName]);

  const [error, setError] = useState("");
  const [toggling, setToggling] = useState<string | null>(null);
  const [justToggled, setJustToggled] = useState<string | null>(null);
  const [offboarding, setOffboarding] = useState<DepartMode | null>(null);
  const [creatingRole, setCreatingRole] = useState(false);
  const [overriding, setOverriding] = useState(false);
  // Stores the intent, not the masks: commitOverride recomputes them from the render current at confirm time.
  const [pendingRevoke, setPendingRevoke] = useState<{ permission: Permission; next: OverrideState } | { kind: "role"; roleId: string; add: boolean } | "clear" | null>(null);
  const [pendingOwnerRole, setPendingOwnerRole] = useState<TeamRole | null>(null);
  const [confirmingPrimary, setConfirmingPrimary] = useState(false);

  const ownershipCtx = useOwnershipContext(teamId, viewer, teamRoles);
  const ownership = memberOwnership(ownershipCtx, { userId: member.user_id, isMe, isOwner: isTargetOwner });
  const canRemove = canManageMembers && !ownership.protectedFromViewer && !isMe;
  const departMode: DepartMode = ownership.canLeave ? "leave" : "remove";

  const runReversible = async (opts: {
    pending: string;
    success: string;
    label: string;
    run: () => Promise<void>;
    undo: () => Promise<void>;
    redo: () => Promise<void>;
  }) => {
    await runTeamAction({ pending: opts.pending, success: opts.success, run: opts.run });
    push({
      label: opts.label,
      undo: async () => { await opts.undo(); onUpdated(); },
      redo: async () => { await opts.redo(); onUpdated(); },
    });
  };

  const wouldLoseKey = async (next: MemberDraft, busy: (on: boolean) => void) => {
    busy(true);
    try {
      if (getServerCapability("permissionPreview")) {
        try {
          return await losesVaultKey(teamId, member.user_id, next);
        } catch {}
      }
      return dropsConnectSource(member, teamRoles, next, locked);
    } finally {
      busy(false);
    }
  };

  const applyRoleToggle = async (role: TeamRole, add: boolean, rotate: boolean) => {
    const hasRole = !add;
    const store = useTeamStore.getState();
    const assign = () => store.assignMemberRole(teamId, member.user_id, role.id);
    const remove = () => store.removeMemberRole(teamId, member.user_id, role.id);

    setToggling(role.id);
    setError("");
    try {
      await runReversible(
        hasRole
          ? {
              pending: t("members.toast.removingRoleFrom", { role: roleLabel(t, role.name), name: memberLabel(member) }),
              success: t("members.toast.roleRemovedFrom", { role: roleLabel(t, role.name), name: memberLabel(member) }),
              label: t("members.history.removeRole", { name: memberLabel(member) }),
              run: remove, undo: assign, redo: remove,
            }
          : {
              pending: t("members.toast.assigningRoleTo", { role: roleLabel(t, role.name), name: memberLabel(member) }),
              success: t("members.toast.roleAssignedTo", { role: roleLabel(t, role.name), name: memberLabel(member) }),
              label: t("members.history.assignRole", { name: memberLabel(member) }),
              run: assign, undo: remove, redo: assign,
            },
      );
      onUpdated();
      if (rotate) void rotateTeamKeyNow(teamId);
      setJustToggled(role.id);
      setTimeout(() => setJustToggled(null), 700);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("members.error.failedToUpdateRole"));
    } finally {
      setToggling(null);
    }
  };

  const handleToggleRole = whenWritable(async (role: TeamRole, confirmed = false) => {
    const hasRole = member.role_ids.includes(role.id);
    if (isOwnerRole(role) && hasRole && ownership.isPrimaryOwner) {
      setError(t("members.error.cannotRemoveOwnerRole"));
      return;
    }
    if (isOwnerRole(role) && !confirmed) {
      setPendingOwnerRole(role);
      return;
    }
    if (!isOwnerRole(role)) {
      setError("");
      const role_ids = hasRole ? member.role_ids.filter((id) => id !== role.id) : [...member.role_ids, role.id];
      const loses = await wouldLoseKey(
        { role_ids, allow: member.permission_allow ?? 0, deny: member.permission_deny ?? 0 },
        (on) => setToggling(on ? role.id : null),
      );
      if (loses) {
        setPendingRevoke({ kind: "role", roleId: role.id, add: !hasRole });
        return;
      }
    }
    await applyRoleToggle(role, !hasRole, false);
  });

  const allow = member.permission_allow ?? 0;
  const deny = member.permission_deny ?? 0;
  const viewerEffective = useHeldPermissionBits(teamId);
  const memberEffective = effectivePermissions(member, teamRoles, locked);

  // A server predating overrides omits both masks; a zero mask serializes as 0.
  const serverSupportsOverrides =
    member.permission_allow !== undefined || member.permission_deny !== undefined;

  // Retired, but shown when set: otherwise no row can clear it as an offending bit.
  const editablePermissions = (Object.keys(PERM_META) as Permission[])
    .filter((p) => isEditablePermission(p, allow | deny));

  const readOnly = memberReadOnly({
    member,
    viewerRoleIds: viewer ? viewer.role_ids : null,
    viewerBits: viewerEffective,
    canManageMembers,
    isTargetOwner,
    isMe,
    teamRoles,
    locked,
  });
  const roleReadOnlyReason = readOnlyReasonText(t, readOnly.roleBlock);

  const rowDisabled = (permission: Permission) =>
    locked || overriding || pendingRevoke !== null || overrideRowLocked(readOnly.kind, permission, readOnly.offendingBits);

  const writeMasks = (masks: { allow: number; deny: number }) =>
    useTeamStore.getState().setMemberPermissions(teamId, member.user_id, masks.allow, masks.deny);

  const applyMasks = async (
    masks: { allow: number; deny: number },
    rotate: boolean,
    history?: HistoryEntry,
  ) => {
    setError("");
    setOverriding(true);
    try {
      await writeMasks(masks);
      if (history) push(history);
      onUpdated();
      if (rotate) void rotateTeamKeyNow(teamId);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("members.error.failedToUpdatePermissions"));
    } finally {
      setOverriding(false);
    }
  };

  const clearOverrides = whenWritable(async () => {
    const cleared = { allow: 0, deny: 0 };
    if (await wouldLoseKey({ role_ids: member.role_ids, ...cleared }, setOverriding)) {
      setPendingRevoke("clear");
      return;
    }
    await applyMasks(cleared, false);
  });

  const commitOverride = async (permission: Permission, next: OverrideState, rotate: boolean) => {
    const updated = applyOverrideState(permission, allow, deny, next);
    // Undo/redo re-read the masks so a concurrent admin's other bits survive the full-replace PUT;
    // a member missing from the store can't be safely masked to 0/0, so bail.
    const at = (state: OverrideState) => () => {
      const m = useTeamStore.getState().membersByTeam[teamId]?.find((x) => x.user_id === member.user_id);
      if (!m) throw new Error(t("members.error.failedToUpdatePermissions"));
      return writeMasks(applyOverrideState(permission, m.permission_allow ?? 0, m.permission_deny ?? 0, state));
    };
    await applyMasks(updated, rotate, {
      label: t("members.history.changePermissions", { name: memberLabel(member) }),
      undo: at(overrideStateOf(permission, allow, deny)),
      redo: at(next),
    });
  };

  const handleOverride = whenWritable(async (permission: Permission, next: OverrideState) => {
    if (next === "allow" && (viewerEffective & PERM_BITS[permission]) === 0) {
      setError(t("members.permissions.readOnlyNotHeld"));
      return;
    }
    const updated = applyOverrideState(permission, allow, deny, next);
    if (await wouldLoseKey({ role_ids: member.role_ids, ...updated }, setOverriding)) {
      setPendingRevoke({ permission, next });
      return;
    }
    await commitOverride(permission, next, false);
  });

  const confirmRevoke = () => {
    const pending = pendingRevoke;
    setPendingRevoke(null);
    if (!pending) return;
    if (pending === "clear") void applyMasks({ allow: 0, deny: 0 }, true);
    else if ("kind" in pending) {
      const role = teamRoles.find((r) => r.id === pending.roleId);
      if (role) void applyRoleToggle(role, pending.add, true);
    } else void commitOverride(pending.permission, pending.next, true);
  };

  const confirmPrimary = () => {
    setConfirmingPrimary(false);
    setError("");
    void runTeamAction({
      pending: t("members.toast.makingPrimaryOwner", { name: memberLabel(member) }),
      success: t("members.toast.primaryOwnerChanged", { name: memberLabel(member) }),
      run: () => useTeamStore.getState().transferBillingOwner(teamId, member.user_id),
    })
      .then(onUpdated)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  const hasOverrides = (allow | deny) !== 0;
  const removeGreyed = greyedUnless(canRemove || ownership.canLeave);

  return {
    ownership,
    locked,
    readOnly,
    name: {
      value: draftName,
      setValue: (v) => { markDirty(); setDraftName(v); },
      commit: flush,
      revert: () => setDraftName(member.member_name ?? ""),
      saveState,
      readOnly: !canNameMembers || previewing,
      title: greyedUnless(canNameMembers).title,
      error: nameError,
    },
    roles: {
      list: teamRoles,
      showOwner: ownership.canGrantOwner,
      readOnlyReason: roleReadOnlyReason,
      busyRoleId: toggling,
      flashRoleId: justToggled,
      disabledReason: (role) => roleChipBlockReason(t, role, {
        hasRole: member.role_ids.includes(role.id), locked, readOnlyReason: roleReadOnlyReason,
      }),
      toggle: (role) => void handleToggleRole(role),
      create: whenWritable(() => setCreatingRole(true)),
    },
    overrides: {
      visible: serverSupportsOverrides,
      lockedEmpty: readOnly.lockedEmpty,
      hasOverrides,
      rows: editablePermissions.map((permission) => ({
        permission,
        state: overrideStateOf(permission, allow, deny),
        inheritedFrom: rolesGranting(t, teamRoles, member.role_ids, locked, permission),
        granted: (memberEffective & PERM_BITS[permission]) !== 0,
        disabled: rowDisabled(permission),
      })),
      setState: (permission, next) => void handleOverride(permission, next),
      clear: hasOverrides && readOnly.kind === null ? clearOverrides : undefined,
    },
    primaryOwner: {
      shown: ownershipCtx.multiOwner && ownership.isOwner && (ownership.isPrimaryOwner || ownership.canMakePrimary),
      isPrimary: ownership.isPrimaryOwner,
      billingEnabled: ownershipCtx.billingEnabled,
      make: ownership.isPrimaryOwner ? undefined : whenWritable(() => setConfirmingPrimary(true)),
    },
    remove: {
      label: departMode,
      disabled: removeGreyed.disabled,
      title: removeGreyed.title,
      leaveBlocked: isMe && ownershipCtx.multiOwner && ownership.isPrimaryOwner,
      open: whenWritable(() => setOffboarding(departMode)),
    },
    error: error || null,
    dialogs: {
      ownerRole: pendingOwnerRole && {
        kind: member.role_ids.includes(pendingOwnerRole.id) ? "revoke" : "grant",
        cancel: () => setPendingOwnerRole(null),
        confirm: () => {
          setPendingOwnerRole(null);
          void handleToggleRole(pendingOwnerRole, true);
        },
      },
      primary: confirmingPrimary ? { confirm: confirmPrimary, cancel: () => setConfirmingPrimary(false) } : null,
      revokeKey: pendingRevoke ? { confirm: confirmRevoke, cancel: () => setPendingRevoke(null) } : null,
      offboarding: offboarding && { mode: offboarding, close: () => setOffboarding(null), done: onUpdated },
      roleModal: creatingRole ? { close: () => { setCreatingRole(false); onUpdated(); } } : null,
    },
  };
}
