import { useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { TeamMember } from "@/services/teamService";
import { departConsequences, departMembers, type DepartMode } from "@/services/teamOffboarding";

interface OffboardingDialogProps {
  members: TeamMember[];
  teamId: string;
  mode: DepartMode;
  onClose: () => void;
  onDone?: () => void;
}

/**
 * The one confirmation for every departure — detail panel, context menu, bulk
 * selection and leave. Before this, the bulk path removed people with no
 * confirmation at all while the single path was two-step.
 */
export function OffboardingDialog({ members, teamId, mode, onClose, onDone }: OffboardingDialogProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const consequences = departConsequences(mode, members.map((m) => m.handle ?? ""));

  const confirm = async () => {
    setBusy(true);
    try {
      await departMembers(teamId, members, { mode, onDone });
    } finally {
      setBusy(false);
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-sm mx-4 rounded-2xl p-6 space-y-5"
        style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)" }}
      >
        <div className="flex items-start gap-3">
          <span
            className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)" }}
          >
            <Icon icon={mode === "leave" ? "lucide:log-out" : "lucide:user-minus"} width={16} style={{ color: "var(--t-status-error)" }} />
          </span>
          <h2 className="text-base font-semibold mt-1" style={{ color: "var(--t-text-primary)" }}>
            {consequences.title}
          </h2>
        </div>

        <ul className="space-y-2">
          {consequences.points.map((point) => (
            <li key={point} className="flex gap-2 text-xs" style={{ color: "var(--t-text-secondary)" }}>
              <Icon icon="lucide:minus" width={11} className="shrink-0 mt-0.5" />
              <span>{point}</span>
            </li>
          ))}
        </ul>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-2 rounded-lg text-xs font-medium transition-colors"
            style={{ background: "var(--t-bg-elevated)", border: "1px solid var(--t-border)", color: "var(--t-text-primary)" }}
          >
            {t("settings.shared.cancel")}
          </button>
          <button
            onClick={() => void confirm()}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-opacity"
            style={{ background: "var(--t-status-error)", color: "#fff", opacity: busy ? 0.6 : 1 }}
          >
            {busy && <Icon icon="lucide:loader-circle" width={12} className="animate-spin" />}
            {consequences.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
