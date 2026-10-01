import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { IdentityPickIssue } from "@/services/credentialPlan";
import { DecisionPanel } from "./DecisionPanel";
import type { DecisionPanelAction } from "./types";

export function IdentityUnavailablePanel({
  issue,
  onChoose,
  onUseHost,
  onCancel,
}: {
  issue: IdentityPickIssue;
  onChoose?: () => void;
  onUseHost?: () => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const actions: DecisionPanelAction[] = [];
  if (onChoose) actions.push({ label: t("terminal.overlay.identityPick.choose"), variant: "primary", onClick: onChoose });
  if (issue.hasFallback && onUseHost) {
    actions.push({
      label: issue.fallbackName
        ? t("terminal.overlay.identityPick.useHostNamed", { name: issue.fallbackName })
        : t("terminal.overlay.identityPick.useHost"),
      variant: "secondary",
      onClick: onUseHost,
    });
  }
  if (onCancel) actions.push({ label: t("common.action.cancel"), variant: "ghost", onClick: onCancel });

  return (
    <DecisionPanel
      tone="warning"
      icon={<Icon icon="lucide:circle-alert" width={14} className="text-yellow-400" />}
      title={t("terminal.overlay.identityPick.title")}
      description={
        issue.reason === "forbidden" && issue.identityName
          ? t("terminal.overlay.identityPick.forbiddenBody", { identity: issue.identityName, host: issue.connectionName })
          : t("terminal.overlay.identityPick.missingBody", { host: issue.connectionName })
      }
      actions={actions}
    />
  );
}
