import type { Step, StepConfig, StepStatus } from "./types";

export function isPassphraseError(msg?: string): boolean {
  if (!msg) return false;
  return msg.includes("The key is encrypted") || msg.toLowerCase().includes("invalid passphrase");
}

export function isNoAuthError(msg?: string): boolean {
  if (!msg) return false;
  return msg.includes("No authentication method provided");
}

export function isMissingUsernameError(msg?: string): boolean {
  if (!msg) return false;
  return msg.includes("No username provided");
}

export function createSteps(stepConfigs: readonly StepConfig[]): Step[] {
  return stepConfigs.map((step) => ({ ...step, status: "pending" }));
}

export function activateStep(
  currentSteps: Step[],
  stepConfigs: readonly StepConfig[],
  id: string,
  detail?: string,
): Step[] {
  const ids = stepConfigs.map((step) => step.id);
  const currentIdx = ids.indexOf(id);

  return currentSteps.map((step) => {
    const stepIdx = ids.indexOf(step.id);
    if (stepIdx < currentIdx) return { ...step, status: "done" };
    if (step.id === id) return { ...step, status: "active", detail };
    return step;
  });
}

export function markErrorStep(currentSteps: Step[], lastActivatedId: string | null): Step[] {
  const activeIdx = currentSteps.findIndex((step) => step.status === "active");
  if (activeIdx !== -1) {
    return currentSteps.map((step, index) => index === activeIdx ? { ...step, status: "error" } : step);
  }
  if (lastActivatedId) {
    return currentSteps.map((step) => step.id === lastActivatedId ? { ...step, status: "error" } : step);
  }
  return currentSteps.map((step, index) => index === 0 ? { ...step, status: "error" } : step);
}

export function getStepTextClass(status: StepStatus): string {
  if (status === "done") return "text-text-secondary";
  if (status === "error") return "text-status-error";
  if (status === "active") return "text-text-primary";
  return "text-text-muted";
}

export function truncateFp(fp: string): string {
  const colonIdx = fp.indexOf(":");
  if (colonIdx !== -1) {
    const algo = fp.slice(0, colonIdx + 1);
    const hash = fp.slice(colonIdx + 1);
    return algo + (hash.length > 20 ? hash.slice(0, 20) + "…" : hash);
  }
  return fp.length > 26 ? fp.slice(0, 26) + "…" : fp;
}
