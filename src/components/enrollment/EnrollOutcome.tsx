import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { ErrorMsg } from "@/components/layout/authParts";
import { resendVerificationEmail } from "@/services/account";
import type { EnrollmentOutcome } from "@/services/enrollment/enrollmentPublic";

export interface CardAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
  loading?: boolean;
}

export function Heading({ title, body }: { title: string; body: ReactNode }) {
  return (
    <>
      <p className="text-sm mb-1.5 text-center font-medium text-(--t-text-bright) break-words">{title}</p>
      <p className="text-xs mb-4 text-center leading-relaxed text-(--t-text-secondary) break-words">{body}</p>
    </>
  );
}

export function StateCard({ icon, color, title, body, actions, children }: {
  icon: string;
  color: string;
  title: string;
  body: ReactNode;
  actions: CardAction[];
  children?: ReactNode;
}) {
  return (
    <div className="w-full">
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mx-auto mb-3"
        style={{
          background: `color-mix(in srgb, ${color} 12%, transparent)`,
          border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
        }}
      >
        <Icon icon={icon} width={20} style={{ color }} />
      </div>
      <Heading title={title} body={body} />
      {children}
      <div className="space-y-2">
        {actions.map(({ label, onClick, primary = true, loading }) => (
          <button
            key={label}
            type="button"
            onClick={onClick}
            disabled={loading}
            className={`btn ${primary ? "btn-primary" : "btn-secondary"} w-full py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2`}
          >
            {loading && <Icon icon="lucide:loader-circle" width={14} className="animate-spin" />}
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

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

export function EnrollOutcome({ teamName, email, outcome, onContinue }: {
  teamName: string;
  email: string;
  outcome: EnrollmentOutcome;
  onContinue: () => void;
}) {
  const { t } = useTranslation();
  const [resend, setResend] = useState<{ busy: boolean; error: string; sent: boolean }>({ busy: false, error: "", sent: false });
  const kind = kindOf(outcome);
  const vars = { team: teamName, email };

  const resendEmail = async () => {
    setResend({ busy: true, error: "", sent: false });
    try {
      await resendVerificationEmail();
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
