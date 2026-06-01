import type { Step, StepStatus } from "./types";
import { getStepTextClass } from "./utils";

export function ConnectionSteps({ steps }: { steps: Step[] }) {
  return (
    <div className="w-full space-y-2.5 text-left">
      {steps.map((step) => (
        <div
          key={step.id}
          className={`flex items-center gap-3 transition-opacity duration-200 ${
            step.status === "pending" ? "opacity-25" : "opacity-100"
          }`}
        >
          <StepIcon status={step.status} />
          <div className="min-w-0">
            <span className={`text-sm ${getStepTextClass(step.status)}`}>{step.label}</span>
            {step.detail && step.status !== "pending" && (
              <p className="text-text-muted text-xs truncate">{step.detail}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "done") {
    return (
      <div className="w-5 h-5 rounded-full bg-status-online/15 flex items-center justify-center shrink-0">
        <svg width="9" height="9" viewBox="0 0 10 8" fill="none" stroke="#22c55e" strokeWidth="2">
          <polyline points="1,4 4,7 9,1" />
        </svg>
      </div>
    );
  }
  if (status === "active") {
    return <div className="w-5 h-5 rounded-full border-2 border-accent/30 border-t-accent shrink-0 animate-spin" />;
  }
  if (status === "error") {
    return (
      <div className="w-5 h-5 rounded-full bg-status-error/15 flex items-center justify-center shrink-0">
        <svg width="9" height="9" viewBox="0 0 10 10" stroke="#ef4444" strokeWidth="2">
          <line x1="2" y1="2" x2="8" y2="8" />
          <line x1="8" y1="2" x2="2" y2="8" />
        </svg>
      </div>
    );
  }
  return <div className="w-5 h-5 rounded-full border border-border/50 shrink-0" />;
}
