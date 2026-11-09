import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { MiniAvatar } from "@/components/shared/AvatarStack";
import { BaseCard } from "@/components/shared/BaseCard";
import { BusinessLockLine } from "@/components/shared/BusinessLockBanner";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { useBusinessLock } from "@/hooks/useBusinessLock";
import { enrollmentApi, EnrollmentError, type JoinRequest } from "@/services/enrollment/enrollmentApi";
import { userFacingReason } from "@/services/errorReason";
import { runTeamAction } from "@/services/teamActionFeedback";
import { useTeamStore } from "@/stores/teamStore";

const SMALL_BTN = "btn px-2.5 py-1 rounded-lg text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed shrink-0";
const NO_REQUESTS: JoinRequest[] = [];

const isPlanRefusal = (e: unknown) => e instanceof EnrollmentError && e.code === "ENROLLMENT_UNAVAILABLE";
const isNoSeat = (e: unknown) => e instanceof EnrollmentError && e.code === null && e.status === 402;

function errorMessage(t: TFunction, e: Error): string {
  if (isPlanRefusal(e)) return t("members.enrollment.error.unavailable");
  if (isNoSeat(e)) return t("members.joinRequests.noSeatToast");
  if (e instanceof EnrollmentError && e.status === 404) return t("members.joinRequests.gone");
  return userFacingReason(e);
}

function RequestRow({ r, busy, locked, onApprove, onDeny }: {
  r: JoinRequest;
  busy: boolean;
  locked: boolean;
  onApprove: () => void;
  onDeny: () => void;
}) {
  const { t } = useTranslation();
  const name = r.display_name || r.email;
  const noSeat = r.reason === "seat_limit";
  const canApprove = !(r.reason === "email_unverified" && !r.email_proven);
  return (
    <BaseCard isList>
      <MiniAvatar name={name} size={28} />
      <p className="text-sm font-medium-bold truncate w-52 shrink-0 text-(--t-text-bright)">{name}</p>
      <p className="text-xs truncate flex-1 min-w-0 text-(--t-text-secondary)">
        {r.display_name && <>{r.email} · </>}
        {t("members.joinRequests.via")}
      </p>
      <span
        className="text-[10px] px-2 py-0.5 rounded-full shrink-0"
        style={{
          color: noSeat ? "var(--t-status-warning)" : "var(--t-text-dim)",
          background: noSeat ? "color-mix(in srgb, var(--t-status-warning) 12%, transparent)" : "var(--t-bg-elevated)",
        }}
      >
        {t(`members.joinRequests.reason.${r.reason}`)}
      </span>
      {canApprove && (
        <button
          title={noSeat ? t("members.joinRequests.noSeatHint") : undefined}
          disabled={busy || locked || noSeat}
          onClick={onApprove}
          className={`${SMALL_BTN} btn-primary`}
        >
          {t("members.joinRequests.approve")}
        </button>
      )}
      <button disabled={busy} onClick={onDeny} className={`${SMALL_BTN} btn-secondary`}>
        {t("members.joinRequests.deny")}
      </button>
    </BaseCard>
  );
}

export function JoinRequestsSection({ teamId }: { teamId: string }) {
  const { t } = useTranslation();
  const { locked } = useBusinessLock(teamId);
  const requests = useTeamStore((s) => s.joinRequestsByTeam[teamId]) ?? NO_REQUESTS;
  const loadJoinRequests = useTeamStore((s) => s.loadJoinRequests);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    loadJoinRequests(teamId).catch(() => {});
  }, [teamId, loadJoinRequests]);

  const act = async (r: JoinRequest, kind: "approve" | "deny") => {
    setBusyId(r.id);
    try {
      await runTeamAction({
        pending: t(`members.joinRequests.toast.${kind}.pending`),
        success: t(`members.joinRequests.toast.${kind}.done`),
        warning: (o) => (o && o.status === "pending" ? t("members.joinRequests.noSeatToast") : null),
        error: (e) => t(`members.joinRequests.toast.${kind}.failed`, { reason: errorMessage(t, e) }),
        run: async () => {
          if (kind === "deny") {
            await enrollmentApi.denyJoinRequest(teamId, r.id);
            return null;
          }
          const outcome = await enrollmentApi.approveJoinRequest(teamId, r.id);
          if (outcome.status !== "pending") await useTeamStore.getState().loadMembers(teamId);
          return outcome;
        },
      });
    } catch (e) {
      if (isPlanRefusal(e)) void useTeamStore.getState().loadTeams();
    } finally {
      await loadJoinRequests(teamId).catch(() => {});
      setBusyId(null);
    }
  };

  if (requests.length === 0) return null;
  return (
    <div data-join-requests>
      <SectionHeader label={t("members.joinRequests.title")} count={requests.length} />
      <BusinessLockLine teamId={teamId} label={t("members.enrollment.lapsed")} />
      <div className="flex flex-col gap-1.5">
        {requests.map((r) => (
          <RequestRow
            key={r.id}
            r={r}
            busy={busyId === r.id}
            locked={locked}
            onApprove={() => void act(r, "approve")}
            onDeny={() => void act(r, "deny")}
          />
        ))}
      </div>
    </div>
  );
}
