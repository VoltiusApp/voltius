import { useEffect, useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { useIdentityStore } from "@/stores/identityStore";
import { useKeyStore } from "@/stores/keyStore";
import { useTeamStore } from "@/stores/teamStore";
import { useUIStore } from "@/stores/uiStore";
import { resolveVaultIdForSave } from "@/hooks/useWritableVaultIds";
import { selectVaultScopedItems } from "@/utils/vaultScopedItems";
import { Pills } from "@/components/shared/Pills";
import IdentitySelector from "@/components/connections/IdentitySelector";
import KeySelector from "@/components/connections/KeySelector";
import { DecisionPanel } from "./DecisionPanel";
import type { ConnectRetryOverride } from "./types";

type AuthMode = "password" | "key" | "identity";

const AUTH_MODES = [
  { value: "password" as const, label: "Password" },
  { value: "key" as const, label: "Key" },
  { value: "identity" as const, label: "Identity" },
];

export function AuthPromptPanel({
  vaultId,
  onSubmit,
  onCancel,
}: {
  vaultId?: string;
  onSubmit: (override: ConnectRetryOverride, save: boolean) => void;
  onCancel?: () => void;
}) {
  const { identities, teamIdentities, loadIdentities } = useIdentityStore();
  const { keys, teamKeys, loadKeys } = useKeyStore();
  const teams = useTeamStore((s) => s.teams);
  const setActiveNav = useUIStore((s) => s.setActiveNav);

  const [mode, setMode] = useState<AuthMode>("password");
  const [identityId, setIdentityId] = useState<string | null>(null);
  const [keyId, setKeyId] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);

  useEffect(() => {
    void loadIdentities();
    void loadKeys();
  }, [loadIdentities, loadKeys]);

  const teamVaultIds = useMemo(() => new Set(teams.map((team) => team.id)), [teams]);
  const relevantIdentities = useMemo(
    () => selectVaultScopedItems({ vaultId: vaultId ?? "personal", localItems: identities, teamItems: teamIdentities, teamVaultIds, resolveVaultId: resolveVaultIdForSave }),
    [vaultId, identities, teamIdentities, teamVaultIds],
  );
  const relevantKeys = useMemo(
    () => selectVaultScopedItems({ vaultId: vaultId ?? "personal", localItems: keys, teamItems: teamKeys, teamVaultIds, resolveVaultId: resolveVaultIdForSave }),
    [vaultId, keys, teamKeys, teamVaultIds],
  );

  const hasAuth =
    mode === "password" ? !!password :
    mode === "key" ? (!!keyId || !!privateKey.trim()) :
    !!identityId;

  const buildOverride = (): ConnectRetryOverride => {
    if (mode === "identity") return { identityId };
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
  }, [hasAuth, mode, identityId, keyId, password, privateKey, passphrase, onSubmit]);

  return (
    <DecisionPanel
      tone="secure"
      icon={<Icon icon="lucide:key-round" width={14} className="text-[var(--t-text-dim)] shrink-0" />}
      title="AUTHENTICATION REQUIRED"
      description="This host has no authentication method. Choose one to continue."
      actions={[
        {
          label: "Connect & Save",
          disabled: !hasAuth,
          onClick: () => onSubmit(buildOverride(), true),
        },
        {
          label: "Connect",
          variant: "secondary",
          disabled: !hasAuth,
          onClick: () => onSubmit(buildOverride(), false),
        },
        {
          label: "Cancel",
          variant: "ghost",
          onClick: onCancel,
        },
      ]}
    >
      <div className="w-full flex flex-col gap-2.5 text-left">
        <Pills options={AUTH_MODES} value={mode} onChange={setMode} />

        {mode === "password" && (
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              autoFocus
              className="w-full px-3 pr-9 py-2 rounded-lg text-sm outline-none bg-[var(--t-bg-base)] border border-[var(--t-border)] text-[var(--t-text-primary)] focus:border-[var(--t-accent)]"
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPassword((value) => !value)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--t-text-dim)] hover:text-[var(--t-text-primary)] transition-colors"
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
                  className="w-full px-3 py-2 rounded-lg font-mono text-xs h-24 resize-none outline-none bg-[var(--t-bg-base)] border border-[var(--t-border)] text-[var(--t-text-primary)] focus:border-[var(--t-accent)]"
                />
                {privateKey.trim() && (
                  <div className="relative">
                    <input
                      type={showPassphrase ? "text" : "password"}
                      value={passphrase}
                      onChange={(event) => setPassphrase(event.target.value)}
                      placeholder="Key passphrase (optional)"
                      autoComplete="new-password"
                      className="w-full px-3 pr-9 py-2 rounded-lg text-sm outline-none bg-[var(--t-bg-base)] border border-[var(--t-border)] text-[var(--t-text-primary)] focus:border-[var(--t-accent)]"
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowPassphrase((value) => !value)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--t-text-dim)] hover:text-[var(--t-text-primary)] transition-colors"
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
          <IdentitySelector
            value={identityId}
            identities={relevantIdentities}
            onChange={setIdentityId}
            onGoToKeychain={goToKeychain}
          />
        )}
      </div>
    </DecisionPanel>
  );
}
