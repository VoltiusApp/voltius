import { useEffect, useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useKeyStore } from "@/stores/keyStore";
import { useUIStore } from "@/stores/uiStore";
import { useVaultScopedItems } from "@/hooks/useVaultScopedItems";
import { Pills } from "@/components/shared/Pills";
import KeySelector from "@/components/connections/KeySelector";
import { DecisionPanel } from "./DecisionPanel";
import { OverlayIdentityField } from "./OverlayIdentityField";
import { identityOverride, repairSaveTarget, type SaveTarget } from "./saveTarget";
import type { ConnectRetryOverride } from "@/types";

export type AuthMode = "password" | "key" | "identity";

function getAuthModes(t: TFunction) {
  return [
    { value: "password" as const, label: t("terminal.overlay.authPrompt.modePassword") },
    { value: "key" as const, label: t("terminal.overlay.authPrompt.modeKey") },
    { value: "identity" as const, label: t("terminal.overlay.authPrompt.modeIdentity") },
  ];
}

export function AuthPromptPanel({
  vaultId,
  connectionId,
  hostName,
  initialMode,
  repairVia,
  onSubmit,
  onCancel,
}: {
  vaultId?: string;
  connectionId?: string;
  hostName?: string;
  initialMode?: AuthMode;
  repairVia?: "pick" | "default";
  onSubmit: (override: ConnectRetryOverride, save: boolean) => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const { keys, teamKeys, loadKeys } = useKeyStore();
  const setActiveNav = useUIStore((s) => s.setActiveNav);
  const authModes = useMemo(() => getAuthModes(t), [t]);

  const [mode, setMode] = useState<AuthMode>(initialMode ?? "password");
  const [identityId, setIdentityId] = useState<string | null>(null);
  const [saveTarget, setSaveTarget] = useState<SaveTarget>(repairVia ? repairSaveTarget(repairVia) : "host");
  const [keyId, setKeyId] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);

  useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  const relevantKeys = useVaultScopedItems(vaultId, keys, teamKeys);

  const hasAuth =
    mode === "password" ? !!password :
    mode === "key" ? (!!keyId || !!privateKey.trim()) :
    !!identityId;

  const buildOverride = (): ConnectRetryOverride => {
    if (mode === "identity") return identityId ? identityOverride(identityId, saveTarget) : { identityId };
    if (mode === "key") return keyId ? { keyId } : { privateKey: privateKey.trim() || undefined, passphrase: passphrase || undefined };
    return { password: password || undefined };
  };

  const goToKeychain = () => {
    onCancel?.();
    setActiveNav("keychain");
  };

  // Enter submits "Connect & Save" from anywhere in the panel. A window listener
  // is used (rather than onKeyDown on the panel) because selecting from a
  // dropdown returns focus to document.body, so React's bubbling wouldn't reach
  // the panel. The multi-line key textarea keeps Enter for newlines.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.shiftKey) return;
      if (event.target instanceof HTMLTextAreaElement) return;
      if (!hasAuth) return;
      event.preventDefault();
      onSubmit(buildOverride(), true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAuth, mode, identityId, saveTarget, keyId, password, privateKey, passphrase, onSubmit]);

  return (
    <DecisionPanel
      tone="secure"
      icon={<Icon icon="lucide:key-round" width={14} className="text-(--t-text-dim) shrink-0" />}
      title={t("terminal.overlay.authPrompt.title")}
      description={t("terminal.overlay.authPrompt.description")}
      actions={[
        {
          label: t("terminal.overlay.connectAndSave"),
          disabled: !hasAuth,
          onClick: () => onSubmit(buildOverride(), true),
        },
        {
          label: t("common.action.connect"),
          variant: "secondary",
          disabled: !hasAuth,
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
        {!repairVia && <Pills options={authModes} value={mode} onChange={setMode} />}

        {mode === "password" && (
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={t("terminal.overlay.authPrompt.passwordPlaceholder")}
              autoFocus
              className="w-full px-3 pr-9 py-2 rounded-lg text-sm outline-hidden bg-(--t-bg-base) border border-(--t-border) text-(--t-text-primary) focus:border-(--t-accent)"
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPassword((value) => !value)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-(--t-text-dim) hover:text-(--t-text-primary) transition-colors"
            >
              <Icon icon={showPassword ? "lucide:eye-off" : "lucide:eye"} width={14} />
            </button>
          </div>
        )}

        {mode === "key" && (
          <>
            <KeySelector
              value={keyId}
              keys={relevantKeys}
              onChange={(id) => { setKeyId(id); if (id) { setPrivateKey(""); setPassphrase(""); } }}
              onGoToKeychain={goToKeychain}
            />
            {!keyId && (
              <>
                <textarea
                  value={privateKey}
                  onChange={(event) => setPrivateKey(event.target.value)}
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;..."
                  spellCheck={false}
                  className="w-full px-3 py-2 rounded-lg font-mono text-xs h-24 resize-none outline-hidden bg-(--t-bg-base) border border-(--t-border) text-(--t-text-primary) focus:border-(--t-accent)"
                />
                {privateKey.trim() && (
                  <div className="relative">
                    <input
                      type={showPassphrase ? "text" : "password"}
                      value={passphrase}
                      onChange={(event) => setPassphrase(event.target.value)}
                      placeholder={t("terminal.overlay.authPrompt.keyPassphrasePlaceholder")}
                      autoComplete="new-password"
                      className="w-full px-3 pr-9 py-2 rounded-lg text-sm outline-hidden bg-(--t-bg-base) border border-(--t-border) text-(--t-text-primary) focus:border-(--t-accent)"
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowPassphrase((value) => !value)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-(--t-text-dim) hover:text-(--t-text-primary) transition-colors"
                    >
                      <Icon icon={showPassphrase ? "lucide:eye-off" : "lucide:eye"} width={14} />
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {mode === "identity" && (
          <OverlayIdentityField
            vaultId={vaultId}
            connectionId={connectionId}
            hostName={hostName ?? ""}
            identityId={identityId}
            onIdentityChange={setIdentityId}
            saveTarget={saveTarget}
            onSaveTargetChange={setSaveTarget}
            repairVia={repairVia}
            onGoToKeychain={goToKeychain}
          />
        )}
      </div>
    </DecisionPanel>
  );
}
