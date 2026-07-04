import { useEffect, useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useIdentityStore } from "@/stores/identityStore";
import { useTeamStore } from "@/stores/teamStore";
import { useUIStore } from "@/stores/uiStore";
import { resolveVaultIdForSave } from "@/hooks/useWritableVaultIds";
import { selectVaultScopedItems } from "@/utils/vaultScopedItems";
import IdentitySelector from "@/components/connections/IdentitySelector";
import { DecisionPanel } from "./DecisionPanel";
import type { ConnectRetryOverride } from "./types";

export function UsernamePromptPanel({
  vaultId,
  onSubmit,
  onCancel,
}: {
  vaultId?: string;
  onSubmit: (override: ConnectRetryOverride, save: boolean) => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const { identities, teamIdentities, loadIdentities } = useIdentityStore();
  const teams = useTeamStore((s) => s.teams);
  const setActiveNav = useUIStore((s) => s.setActiveNav);

  const [identityId, setIdentityId] = useState<string | null>(null);
  const [username, setUsername] = useState("");

  useEffect(() => {
    void loadIdentities();
  }, [loadIdentities]);

  const teamVaultIds = useMemo(() => new Set(teams.map((team) => team.id)), [teams]);
  const relevantIdentities = useMemo(
    () => selectVaultScopedItems({ vaultId: vaultId ?? "personal", localItems: identities, teamItems: teamIdentities, teamVaultIds, resolveVaultId: resolveVaultIdForSave }),
    [vaultId, identities, teamIdentities, teamVaultIds],
  );

  const trimmed = username.trim();
  // An identity carries its own username (and auth), so picking one is enough.
  const hasValue = identityId ? true : !!trimmed;

  const buildOverride = (): ConnectRetryOverride => (identityId ? { identityId } : { username: trimmed });

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
  }, [hasValue, identityId, username, onSubmit]);

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
        <IdentitySelector
          value={identityId}
          identities={relevantIdentities}
          onChange={setIdentityId}
          onGoToKeychain={goToKeychain}
        />

        {!identityId && (
          <input
            type="text"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder={t("terminal.overlay.usernamePrompt.placeholder")}
            autoFocus
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="w-full px-3 py-2 rounded-lg text-sm outline-hidden bg-(--t-bg-base) border border-(--t-border) text-(--t-text-primary) focus:border-(--t-accent)"
          />
        )}
      </div>
    </DecisionPanel>
  );
}
