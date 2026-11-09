import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { MiniAvatar } from "@/components/shared/AvatarStack";
import { BaseCard } from "@/components/shared/BaseCard";
import { BusinessLockLine } from "@/components/shared/BusinessLockBanner";
import { PresenceAvatar } from "@/components/shared/PresenceAvatar";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { useBusinessLock } from "@/hooks/useBusinessLock";
import { enrollmentApi, type ApproveOutcome, type JoinRequest } from "@/services/enrollment/enrollmentApi";
import { runEnrollmentAction } from "@/services/enrollment/enrollmentAction";
import { useTeamStore } from "@/stores/teamStore";
import { isMobileShell } from "@/utils/platform";

const SMALL_BTN = "btn px-2.5 py-1 rounded-lg text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed shrink-0";
const NO_REQUESTS: JoinRequest[] = [];

interface RowProps {
  r: JoinRequest;
  busy: boolean;
  locked: boolean;
  onApprove: () => void;
  onDeny: () => void;
}

function Actions({ r, busy, locked, onApprove, onDeny }: RowProps) {
  const { t } = useTranslation();
  const canApprove = !(r.reason === "email_unverified" && !r.email_proven);
  return (
    <>
      {canApprove && (
        <button
          title={locked ? t("members.enrollment.lapsed") : undefined}
          disabled={busy || locked}
          onClick={onApprove}
          className={`${SMALL_BTN} btn-primary`}
        >
          {t("members.joinRequests.approve")}
        </button>
      )}
      <button disabled={busy} onClick={onDeny} className={`${SMALL_BTN} btn-secondary`}>
        {t("members.joinRequests.deny")}
      </button>
    </>
  );
}

function RequestRow(props: RowProps) {
  const { t } = useTranslation();
  const { r } = props;
  const name = r.display_name || r.email;
  const noSeat = r.reason === "seat_limit";
  const status = t(`members.joinRequests.reason.${r.reason}`);

  if (isMobileShell()) {
    return (
      <div className="flex flex-col gap-1 px-3 py-2 rounded-lg bg-(--t-bg-card)">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <PresenceAvatar handle={name} size={26} online={false} />
          <span className="text-xs text-(--t-text-primary) break-all flex-1 basis-32 min-w-0">
            {name}
            {r.display_name && <span className="block text-[11px] text-(--t-text-dim)">{r.email}</span>}
          </span>
        </div>
        <div className="flex items-center gap-2 pl-[2.3rem]">
          <span className="text-[11px] flex-1 min-w-0" style={{ color: noSeat ? "var(--t-status-warning)" : "var(--t-text-secondary)" }}>
            {noSeat && <Icon icon="lucide:triangle-alert" width={11} className="inline align-[-1px] mr-1" />}
            {status}
          </span>
          <Actions {...props} />
        </div>
      </div>
    );
  }

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
        {status}
      </span>
      <Actions {...props} />
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
    await runEnrollmentAction<ApproveOutcome | null>(t, {
      toast: `members.joinRequests.toast.${kind}`,
      bare402: "noSeat",
      warning: (o) => (o?.status === "pending" ? t("members.joinRequests.emailUnverifiedToast") : null),
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
    await loadJoinRequests(teamId).catch(() => {});
    setBusyId(null);
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
