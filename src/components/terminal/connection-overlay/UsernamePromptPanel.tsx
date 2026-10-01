import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useUIStore } from "@/stores/uiStore";
import { formIdentifierProps } from "@/components/shared/Panel";
import { DecisionPanel } from "./DecisionPanel";
import { OverlayIdentityField } from "./OverlayIdentityField";
import { identityOverride, type SaveTarget } from "./saveTarget";
import type { ConnectRetryOverride } from "@/types";

export function UsernamePromptPanel({
  vaultId,
  connectionId,
  hostName,
  onSubmit,
  onCancel,
}: {
  vaultId?: string;
  connectionId?: string;
  hostName?: string;
  onSubmit: (override: ConnectRetryOverride, save: boolean) => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const setActiveNav = useUIStore((s) => s.setActiveNav);

  const [identityId, setIdentityId] = useState<string | null>(null);
  const [saveTarget, setSaveTarget] = useState<SaveTarget>("host");
  const [username, setUsername] = useState("");

  const trimmed = username.trim();
  // An identity carries its own username (and auth), so picking one is enough.
  const hasValue = identityId ? true : !!trimmed;

  const buildOverride = (): ConnectRetryOverride => (identityId ? identityOverride(identityId, saveTarget) : { username: trimmed });

  const goToKeychain = () => {
    onCancel?.();
    setActiveNav("keychain");
  };

  // Enter submits "Continue & Save" from anywhere in the panel. A window listener
  // is used (rather than onKeyDown on the panel) because selecting an identity
  // returns focus to document.body, so React's bubbling wouldn't reach the panel.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.shiftKey) return;
      if (!hasValue) return;
      event.preventDefault();
      onSubmit(buildOverride(), true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasValue, identityId, saveTarget, username, onSubmit]);

  return (
    <DecisionPanel
      tone="secure"
      icon={<Icon icon="lucide:user" width={14} className="text-(--t-text-dim) shrink-0" />}
      title={t("terminal.overlay.usernamePrompt.title")}
      description={t("terminal.overlay.usernamePrompt.description")}
      actions={[
        {
          label: t("terminal.overlay.continueAndSave"),
          disabled: !hasValue,
          onClick: () => onSubmit(buildOverride(), true),
        },
        {
          label: t("terminal.overlay.continue"),
          variant: "secondary",
          disabled: !hasValue,
          onClick: () => onSubmit(buildOverride(), false),
        },
        {
          label: t("common.action.cancel"),
          variant: "ghost",
          onClick: onCancel,
        },
      ]}
    >
      <div className="w-full flex flex-col gap-2.5 text-left">
        <OverlayIdentityField
          vaultId={vaultId}
          connectionId={connectionId}
          hostName={hostName ?? ""}
          identityId={identityId}
          onIdentityChange={setIdentityId}
          saveTarget={saveTarget}
          onSaveTargetChange={setSaveTarget}
          onGoToKeychain={goToKeychain}
        />

        {!identityId && (
          <input
            type="text"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder={t("terminal.overlay.usernamePrompt.placeholder")}
            autoFocus
            {...formIdentifierProps}
            className="w-full px-3 py-2 rounded-lg text-sm outline-hidden bg-(--t-bg-base) border border-(--t-border) text-(--t-text-primary) focus:border-(--t-accent)"
          />
        )}
      </div>
    </DecisionPanel>
  );
}
