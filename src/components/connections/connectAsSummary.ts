import type { TFunction } from "i18next";
import type { CredentialPlan, PickTarget } from "@/services/credentialPlan";

export function connectAsSummary(
  plan: CredentialPlan,
  isOwn: (id: string) => boolean,
  hostIdentity: PickTarget | null,
  hasSharedCredential: boolean,
  t: TFunction,
): { title: string; subtitle?: string; icon: string; warn: boolean } {
  if (plan.kind === "pick" || plan.kind === "default") {
    const own = isOwn(plan.identity.id);
    return {
      title: plan.identity.name ?? plan.identity.username,
      subtitle: t(own ? "connections.form.connectAsYours" : "connections.form.connectAsTeam", { username: plan.identity.username }),
      icon: "lucide:user-round-check",
      warn: false,
    };
  }
  if (plan.kind === "unavailable") {
    return { title: t("connections.form.connectAsUnavailable"), icon: "lucide:circle-alert", warn: true };
  }
  if (hasSharedCredential) {
    return {
      title: hostIdentity ? hostIdentity.name ?? hostIdentity.username : t("connections.form.connectAsHost"),
      subtitle: hostIdentity ? t("connections.form.connectAsHost") : undefined,
      icon: "lucide:server",
      warn: false,
    };
  }
  return { title: t("connections.form.connectAsAsk"), icon: "lucide:message-circle-question", warn: false };
}
