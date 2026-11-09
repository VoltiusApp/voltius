import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorMsg } from "@/components/layout/authParts";
import { resendVerificationEmail } from "@/services/account";
import type { EnrollSession } from "@/services/enrollment/enrollAuth";
import type { EnrollmentOutcome } from "@/services/enrollment/enrollmentPublic";
import { StateCard, type CardAction } from "./enrollCards";

type Kind = "member" | "approval" | "email" | "seat";

const LOOK: Record<Kind, { icon: string; color: string }> = {
  member: { icon: "lucide:circle-check-big", color: "var(--t-status-connected)" },
  approval: { icon: "lucide:send", color: "var(--t-accent)" },
  email: { icon: "lucide:mail-check", color: "var(--t-status-warning)" },
  seat: { icon: "lucide:users-round", color: "var(--t-status-warning)" },
};

function kindOf({ status, reason }: EnrollmentOutcome): Kind {
  if (status !== "pending") return "member";
  return reason === "email_unverified" ? "email" : reason === "seat_limit" ? "seat" : "approval";
}

export function EnrollOutcome({ teamName, email, outcome, onContinue, session }: {
  teamName: string;
  email: string;
  outcome: EnrollmentOutcome;
  onContinue: () => void;
  session?: Exclude<EnrollSession, "active">;
}) {
  const { t } = useTranslation();
  const [resend, setResend] = useState<{ busy: boolean; error: string; sent: boolean }>({ busy: false, error: "", sent: false });
  const kind = kindOf(outcome);
  const vars = { team: teamName, email };

  const resendEmail = async () => {
    setResend({ busy: true, error: "", sent: false });
    try {
      await resendVerificationEmail(session);
      setResend({ busy: false, error: "", sent: true });
    } catch (e) {
      setResend({ busy: false, error: e instanceof Error ? e.message : String(e), sent: false });
    }
  };

  const actions: CardAction[] = [{ label: t("layout.enroll.continue"), onClick: onContinue }];
  if (kind === "email") {
    actions.unshift({ label: t("layout.enroll.outcome.email.resend"), onClick: () => void resendEmail(), primary: false, loading: resend.busy });
  }

  return (
    <StateCard
      {...LOOK[kind]}
      title={t(`layout.enroll.outcome.${kind}.title`, vars)}
      body={t(`layout.enroll.outcome.${kind}.body`, vars)}
      actions={actions}
    >
      <ErrorMsg msg={resend.error} />
      {resend.sent && (
        <p role="status" className="text-xs text-center py-1 text-(--t-text-secondary)">
          {t("notifications.emailVerification.toast.sent")}
        </p>
      )}
    </StateCard>
  );
}
