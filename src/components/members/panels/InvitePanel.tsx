import { useEffect, useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { TeamRole } from "@/stores/teamStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { UserSearchField } from "@/components/shared/UserSearchField";
import { PanelShell, PanelHeader, FormSection } from "@/components/shared/Panel";
import BuySeatsModal from "@/components/settings/BuySeatsModal";
import { seatAvailability } from "@/services/seatMath";
import { SeatsMeter } from "@/components/members/SeatsMeter";
import { RoleToggleChip } from "@/components/members/roleChips";
import { useUserSearch, type UserSearchResult } from "@/hooks/useUserSearch";
import { inviteUserWithRoles, inviteByEmailAddress, inviteFailureReason } from "@/services/vaultShare";
import { assignableRoles, leastPrivilegedRole } from "@/components/vault-share/vaultShareModel";

export function isValidEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export interface InvitePanelProps {
  teamId: string;
  existingIds: Set<string>;
  teamRoles: TeamRole[];
  onClose: () => void;
  onMemberAdded: () => void;
}

export function InvitePanel({ teamId, existingIds, teamRoles, onClose, onMemberAdded }: InvitePanelProps) {
  const { t } = useTranslation();
  const { usedSeats, totalSeats, load: reloadSubscription } = useSubscriptionStore();
  const { query, setQuery, results, searching, open, setOpen, inputRef, dropdownRef, reset } =
    useUserSearch(existingIds);
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const [sendingInvite, setSendingInvite] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  const [buySeatsFor, setBuySeatsFor] = useState<UserSearchResult | null | undefined>(undefined);

  const { atLimit: isAtSeatLimit } = seatAvailability(usedSeats, totalSeats);

  const builtinRoles = useMemo(() => assignableRoles(teamRoles), [teamRoles]);
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

  const toggleRole = (roleId: string) =>
    setSelectedRoleIds((prev) =>
      prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId],
    );
  const hasRoleSelected = selectedRoleIds.length > 0;
  // Never relied on by the UI (the invite actions are disabled without a selection) —
  // a pure safety net so no future caller can end up granting "member" by accident.
  const fallbackRoleName = useMemo(() => leastPrivilegedRole(teamRoles)?.name ?? "connect-only", [teamRoles]);
  const primaryRoleName = useMemo(
    () => builtinRoles.find((r) => selectedRoleIds.includes(r.id))?.name ?? fallbackRoleName,
    [selectedRoleIds, builtinRoles, fallbackRoleName],
  );
  const selectedRoleLabel = useMemo(() => {
    const names = selectedRoleIds
      .map((id) => builtinRoles.find((r) => r.id === id)?.name)
      .filter(Boolean);
    return names.length > 0 ? names.join(", ") : t("members.invite.noRoleFallback");
  }, [selectedRoleIds, builtinRoles, t]);

  useEffect(() => { void reloadSubscription(); }, []);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleAdd = async (user: UserSearchResult) => {
    if (!hasRoleSelected) return;
    if (isAtSeatLimit) { setBuySeatsFor(user); setOpen(false); return; }
    setAdding(user.user_id); setError(""); setSuccess("");
    try {
      const result = await inviteUserWithRoles({
        teamId,
        userId: user.user_id,
        handle: user.handle,
        roleIds: selectedRoleIds,
        roles: teamRoles,
      });
      reset();
      setSuccess(result.status === "pending"
        ? t("members.toast.invitationSentToUser", { name: user.handle })
        : t("members.toast.userAdded", { name: user.handle }));
      await reloadSubscription();
      onMemberAdded();
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      if ((e as { code?: number }).code === 402 || err.message.includes("402")) {
        setBuySeatsFor(user); setOpen(false);
      } else {
        setOpen(false);
        setError(t("members.error.inviteFailed", { name: user.handle, reason: inviteFailureReason(err) }));
      }
    } finally { setAdding(null); }
  };

  const handleEmailInvite = async () => {
    if (!isValidEmail(query) || !hasRoleSelected) return;
    if (isAtSeatLimit) { setBuySeatsFor(null); return; }
    setSendingInvite(true); setError(""); setSuccess("");
    try {
      const invitedEmail = query;
      await inviteByEmailAddress({ teamId, email: invitedEmail, roleName: primaryRoleName });
      reset();
      setSuccess(t("members.toast.invitationSentToEmail", { email: invitedEmail }));
      await reloadSubscription();
      onMemberAdded();
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      if ((e as { code?: number }).code === 402 || err.message.includes("402")) {
        setBuySeatsFor(null);
      } else {
        setOpen(false);
        setError(t("members.error.inviteFailed", { name: query, reason: inviteFailureReason(err) }));
      }
    } finally { setSendingInvite(false); }
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
            <SeatsMeter onBuySeats={() => setBuySeatsFor(null)} />
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
              onQueryChange={(v) => { setQuery(v); setSuccess(""); }}
              onClear={() => { reset(); setSuccess(""); }}
              onSubmitQuery={() => { if (isValidEmail(query) && results.length === 0) void handleEmailInvite(); }}
              results={results}
              searching={searching}
              open={open}
              setOpen={setOpen}
              inputRef={inputRef}
              dropdownRef={dropdownRef}
              adding={adding}
              addLabel={t("members.invite.addWithRole", { role: selectedRoleLabel })}
              onAdd={(user) => void handleAdd(user)}
              actionsDisabled={!hasRoleSelected}
              emailOption={{
                visible: showEmailInviteOption,
                label: <>{t("members.invite.sendInviteLabel")} <span className="font-medium">{query}</span></>,
                actionLabel: t("members.invite.inviteArrow"),
                sending: sendingInvite,
                onInvite: () => void handleEmailInvite(),
              }}
            />
          </FormSection>

          {error && <p className="text-xs px-1" style={{ color: "var(--t-status-error)" }}>{error}</p>}
          {success && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl" style={{ background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.2)" }}>
              <Icon icon="lucide:circle-check" width={14} style={{ color: "#34d399" }} />
              <p className="text-xs" style={{ color: "#34d399" }}>{success}</p>
            </div>
          )}
        </div>
      </PanelShell>
    </>
  );
}
