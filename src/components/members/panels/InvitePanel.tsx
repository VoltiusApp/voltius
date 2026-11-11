import { useEffect, useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { TeamRole } from "@/stores/teamStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { UserSearchField } from "@/components/shared/UserSearchField";
import { PanelShell, PanelHeader, FormSection } from "@/components/shared/Panel";
import BuySeatsModal from "@/components/settings/BuySeatsModal";
import { seatAvailability } from "@/services/seatMath";
import { useCanBuySeats } from "@/hooks/useCanBuySeats";
import { SeatsMeter } from "@/components/members/SeatsMeter";
import { RoleToggleChip } from "@/components/members/roleChips";
import { MemberNameInput } from "@/components/members/MemberNameInput";
import { useUserSearch, type UserSearchResult } from "@/hooks/useUserSearch";
import { inviteUserWithRoles, inviteByEmailAddress, inviteFailureReason, emailNotSentWarning } from "@/services/vaultShare";
import { invitationRoleName, isOwnerRole } from "@/components/vault-share/vaultShareModel";
import { useInviteRoleOptions, useOwnerInviteConfirm } from "@/components/members/ownerInvite";
import { useBusinessLock } from "@/hooks/useBusinessLock";

export function isValidEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export interface InvitePanelProps {
  teamId: string;
  existingIds: Set<string>;
  teamRoles: TeamRole[];
  canNameMembers: boolean;
  onClose: () => void;
  onMemberAdded: () => void;
}

export function InvitePanel({ teamId, existingIds, teamRoles, canNameMembers, onClose, onMemberAdded }: InvitePanelProps) {
  const { t } = useTranslation();
  const { usedSeats, effectiveSeats, load: reloadSubscription } = useSubscriptionStore();
  const { query, setQuery, results, searching, open, setOpen, inputRef, dropdownRef, reset } =
    useUserSearch(existingIds);
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const [sendingInvite, setSendingInvite] = useState(false);
  const [memberName, setMemberName] = useState("");
  const [success, setSuccess] = useState<{ text: string; warn?: boolean } | null>(null);
  const [error, setError] = useState("");
  const [buySeatsFor, setBuySeatsFor] = useState<UserSearchResult | null | undefined>(undefined);
  const canBuySeats = useCanBuySeats(teamId);

  // Against the *enforced* cap, not the purchased one: during a trial the server
  // caps at 10 however many seats were bought, and pre-checking the purchased
  // number sends invites it then rejects with 402.
  const { atLimit: isAtSeatLimit } = seatAvailability(usedSeats, effectiveSeats);

  const onSeatLimit = (user: UserSearchResult | null) => {
    setOpen(false);
    if (canBuySeats) setBuySeatsFor(user);
    else setError(t("members.error.seatLimitReached"));
  };

  const nameToSend = canNameMembers ? memberName.trim() || undefined : undefined;

  const { locked: businessLocked } = useBusinessLock(teamId);
  const { options: inviteRoles, ownerLockedReason } = useInviteRoleOptions(teamId, teamRoles);
  const { guard: confirmOwnerInvite, modal: ownerInviteConfirm } = useOwnerInviteConfirm();
  const builtinRoles = useMemo(
    () => inviteRoles.filter((r) => r.is_builtin || !businessLocked),
    [inviteRoles, businessLocked],
  );
  const ownerRoleId = builtinRoles.find(isOwnerRole)?.id;
  const defaultMemberRoleId = useMemo(
    () => builtinRoles.find((r) => r.is_builtin && r.name === "member")?.id,
    [builtinRoles],
  );
  useEffect(() => {
    if (defaultMemberRoleId && selectedRoleIds.length === 0) {
      setSelectedRoleIds([defaultMemberRoleId]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultMemberRoleId]);

  // Owner already holds every permission, so it never travels with another role.
  const toggleRole = (roleId: string) =>
    setSelectedRoleIds((prev) => {
      if (prev.includes(roleId)) return prev.filter((id) => id !== roleId);
      if (roleId === ownerRoleId) return [roleId];
      return [...prev.filter((id) => id !== ownerRoleId), roleId];
    });
  const hasRoleSelected = selectedRoleIds.length > 0;
  const grantsOwner = !!ownerRoleId && selectedRoleIds.includes(ownerRoleId);
  const primaryRoleName = useMemo(() => invitationRoleName(teamRoles, selectedRoleIds), [teamRoles, selectedRoleIds]);
  const selectedRoleLabel = useMemo(() => {
    const names = selectedRoleIds
      .map((id) => builtinRoles.find((r) => r.id === id)?.name)
      .filter(Boolean);
    return names.length > 0 ? names.join(", ") : t("members.invite.noRoleFallback");
  }, [selectedRoleIds, builtinRoles, t]);

  useEffect(() => { void reloadSubscription(); }, []);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const addUser = async (user: UserSearchResult) => {
    if (!hasRoleSelected) return;
    if (isAtSeatLimit) { onSeatLimit(user); return; }
    setAdding(user.user_id); setError(""); setSuccess(null);
    try {
      const result = await inviteUserWithRoles({
        teamId,
        userId: user.user_id,
        handle: user.handle,
        roleIds: selectedRoleIds,
        roles: teamRoles,
        memberName: nameToSend,
      });
      reset();
      setMemberName("");
      setSuccess({ text: result.status === "pending"
        ? t("members.toast.invitationSentToUser", { name: user.handle })
        : t("members.toast.userAdded", { name: user.handle }) });
      await reloadSubscription();
      onMemberAdded();
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      if ((e as { code?: number }).code === 402 || err.message.includes("402")) {
        onSeatLimit(user);
      } else {
        setOpen(false);
        setError(t("members.error.inviteFailed", { name: user.handle, reason: inviteFailureReason(err) }));
      }
    } finally { setAdding(null); }
  };

  const handleAdd = (user: UserSearchResult) => confirmOwnerInvite(grantsOwner, user.handle, () => void addUser(user));

  const inviteEmail = async () => {
    if (isAtSeatLimit) { onSeatLimit(null); return; }
    setSendingInvite(true); setError(""); setSuccess(null);
    try {
      const invitedEmail = query;
      const result = await inviteByEmailAddress({
        teamId, email: invitedEmail, roleName: primaryRoleName, roleIds: selectedRoleIds, memberName: nameToSend,
      });
      reset();
      setMemberName("");
      const warning = emailNotSentWarning(result, invitedEmail);
      setSuccess(warning
        ? { text: warning, warn: true }
        : { text: t("members.toast.invitationSentToEmail", { email: invitedEmail }) });
      await reloadSubscription();
      onMemberAdded();
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      if ((e as { code?: number }).code === 402 || err.message.includes("402")) {
        onSeatLimit(null);
      } else {
        setOpen(false);
        setError(t("members.error.inviteFailed", { name: query, reason: inviteFailureReason(err) }));
      }
    } finally { setSendingInvite(false); }
  };

  const handleEmailInvite = () => {
    if (!isValidEmail(query) || !hasRoleSelected) return;
    confirmOwnerInvite(grantsOwner, query, () => void inviteEmail());
  };

  const noticeColor = success?.warn ? "var(--t-status-warning)" : "#34d399";
  const showEmailInviteOption = open && results.length === 0 && !searching && isValidEmail(query);

  return (
    <>
      {ownerInviteConfirm}
      {buySeatsFor !== undefined && (
        <BuySeatsModal
          teamId={teamId}
          pendingUser={buySeatsFor ?? null}
          pendingRole={primaryRoleName}
          pendingRoleIds={selectedRoleIds}
          pendingName={nameToSend}
          onClose={() => setBuySeatsFor(undefined)}
          onSuccess={async () => {
            setBuySeatsFor(undefined);
            setMemberName("");
            await reloadSubscription();
            onMemberAdded();
          }}
        />
      )}

      <PanelShell>
        <PanelHeader
          icon="lucide:user-plus"
          title={t("members.invite.title")}
          onClose={onClose}
        />

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Seats usage */}
          <FormSection label={t("members.invite.seatsLabel")}>
            <SeatsMeter onBuySeats={canBuySeats ? () => setBuySeatsFor(null) : undefined} />
          </FormSection>

          {/* Role selector */}
          <FormSection label={t("members.invite.initialRoles")}>
            <div className="flex flex-wrap items-start gap-2">
              {builtinRoles.map((r) => (
                <RoleToggleChip
                  key={r.id}
                  name={r.name}
                  active={selectedRoleIds.includes(r.id)}
                  onClick={() => toggleRole(r.id)}
                  disabledReason={isOwnerRole(r) ? ownerLockedReason : undefined}
                  blurb
                />
              ))}
            </div>
            {!hasRoleSelected && (
              <p className="text-xs mt-1.5" style={{ color: "var(--t-text-dim)" }}>{t("members.invite.selectRoleHint")}</p>
            )}
          </FormSection>

          {/* Search input */}
          <FormSection label={t("members.invite.searchOrInviteLabel")} className="overflow-visible">
            <UserSearchField
              placeholder={t("members.invite.searchUserPlaceholder")}
              query={query}
              onQueryChange={(v) => { setQuery(v); setSuccess(null); }}
              onClear={() => { reset(); setSuccess(null); }}
              onSubmitQuery={() => { if (isValidEmail(query) && results.length === 0) handleEmailInvite(); }}
              results={results}
              searching={searching}
              open={open}
              setOpen={setOpen}
              inputRef={inputRef}
              dropdownRef={dropdownRef}
              adding={adding}
              addLabel={t("members.invite.addWithRole", { role: selectedRoleLabel })}
              onAdd={handleAdd}
              actionsDisabled={!hasRoleSelected}
              emailOption={{
                visible: showEmailInviteOption,
                label: <>{t("members.invite.sendInviteLabel")} <span className="font-medium">{query}</span></>,
                actionLabel: t("members.invite.inviteArrow"),
                sending: sendingInvite,
                onInvite: handleEmailInvite,
              }}
            />
          </FormSection>

          {canNameMembers && (
            <FormSection label={t("members.invite.nameLabel")}>
              <MemberNameInput
                aria-label={t("members.invite.nameLabel")}
                value={memberName}
                placeholder={t("members.invite.namePlaceholder")}
                onChange={(e) => setMemberName(e.target.value)}
              />
              <p className="text-[11px] mt-1.5" style={{ color: "var(--t-text-secondary)" }}>{t("members.invite.nameHint")}</p>
            </FormSection>
          )}

          {error && <p className="text-xs px-1" style={{ color: "var(--t-status-error)" }}>{error}</p>}
          {success && (
            <div
              role={success.warn ? "alert" : undefined}
              className="flex items-center gap-2 px-3 py-2.5 rounded-xl"
              style={{ background: `color-mix(in srgb, ${noticeColor} 8%, transparent)`, border: `1px solid color-mix(in srgb, ${noticeColor} 20%, transparent)` }}
            >
              <Icon icon={success.warn ? "lucide:triangle-alert" : "lucide:circle-check"} width={14} className="shrink-0" style={{ color: noticeColor }} />
              <p className="text-xs" style={{ color: noticeColor }}>{success.text}</p>
            </div>
          )}
        </div>
      </PanelShell>
    </>
  );
}
