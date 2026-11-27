import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConnectionHeader } from "./ConnectionHeader";
import { ConnectionErrorPanel, ReconnectBanner, ReconnectWaitPanel } from "./ConnectionStatusPanel";
import { ConnectionSteps } from "./ConnectionSteps";
import { NetbirdSetup } from "./NetbirdPanel";
import { HostKeyConflictPanel } from "./HostKeyConflictPanel";
import { IdentityUnavailablePanel } from "./IdentityUnavailablePanel";
import { PassphrasePromptPanel } from "./PassphrasePromptPanel";
import { BrowserCheckPanel } from "./BrowserCheckPanel";
import { AuthPromptPanel } from "./AuthPromptPanel";
import { UsernamePromptPanel } from "./UsernamePromptPanel";
import { VaultErrorPanel } from "./VaultErrorPanel";
import { useConnectionSteps, useHostKeyConflict } from "./hooks";
import { useDismissBlockedReason } from "@/hooks/useSessionLocked";
import { DismissBlockedContext } from "./dismissBlocked";
import type { ConnectionOverlayProps } from "./types";
import { isMissingUsernameError, isNoAuthError, isPassphraseError } from "./utils";
import { isVaultErrorCode } from "@/services/vaultErrors";

export default function ConnectionOverlay({
  sessionId,
  status,
  errorMessage,
  errorCode,
  name,
  subtitle,
  icon,
  vaultId,
  connectionId,
  steps: stepConfigs,
  stepEventName,
  conflictEventName,
  verificationUrl,
  netbirdChallenge,
  onNetbirdLogin,
  className,
  onDismiss,
  onRetry,
  reconnectWait,
  onRetryNow,
  onRetryWithPassphrase,
  onRetryWithAuth,
  identityPick,
  onUseHostCredential,
  onEnableLegacyAlgorithms,
  variant,
}: ConnectionOverlayProps) {
  const dismissBlocked = useDismissBlockedReason(sessionId);
  const { t } = useTranslation();
  const { steps, visible } = useConnectionSteps({ status, errorCode, stepConfigs, stepEventName });
  const { conflict, resolving, resolveConflict } = useHostKeyConflict({
    sessionId,
    status,
    conflictEventName,
  });

  const [choosing, setChoosing] = useState(false);
  useEffect(() => setChoosing(false), [identityPick]);

  if (!visible) return null;

  const isError = status === "error";
  const isConnecting = status === "connecting";
  // Outranks the message-based prompts: the credentials are stored, just unreadable.
  const vaultCode = isError && isVaultErrorCode(errorCode) ? errorCode : null;
  const pickIsHere = !!identityPick && identityPick.connectionId === connectionId;
  const showIdentityPick = isError && !!identityPick && !choosing;
  const showChooser = isError && pickIsHere && choosing && !!onRetryWithAuth;
  const showVaultError = !identityPick && !!vaultCode;
  const prompting = isError && !identityPick && !vaultCode;
  const showPassphrasePrompt = prompting && isPassphraseError(errorMessage) && !!onRetryWithPassphrase;
  const showUsernamePrompt = prompting && isMissingUsernameError(errorMessage) && !!onRetryWithAuth;
  const showAuthPrompt = prompting && isNoAuthError(errorMessage) && !!onRetryWithAuth;
  const legacyFix = isError && errorCode === "ssh-legacy-algorithms-required" ? onEnableLegacyAlgorithms : undefined;
  const checkUrl = isConnecting && (netbirdChallenge?.verificationUri ?? verificationUrl);
  const setupNetbird = isError && errorCode === "ssh-netbird-sso-required" && onNetbirdLogin;
  const showSpecialPanel =
    setupNetbird || checkUrl || (conflict && !isError) || showIdentityPick || showChooser || showVaultError || showPassphrasePrompt || showUsernamePrompt || showAuthPrompt;

  if (variant === "banner" && isConnecting && !showSpecialPanel) {
    return (
      <DismissBlockedContext.Provider value={dismissBlocked}>
        <ReconnectBanner wait={reconnectWait} onRetryNow={onRetryNow} onDismiss={onDismiss} />
      </DismissBlockedContext.Provider>
    );
  }

  return (
    <DismissBlockedContext.Provider value={dismissBlocked}>
      <div className={className ?? "absolute inset-0 z-20 flex items-center justify-center bg-(--t-bg-terminal)"}>
        <div className="flex flex-col items-center gap-6 w-80 text-center">
          <ConnectionHeader
            icon={icon}
            name={name}
            subtitle={subtitle}
            isConnecting={isConnecting}
            showSpecialPanel={!!showSpecialPanel}
          />

          {conflict && !isError ? (
            <HostKeyConflictPanel conflict={conflict} resolving={resolving} onResolve={(action) => void resolveConflict(action)} />
          ) : checkUrl ? (
            <BrowserCheckPanel
              key={checkUrl}
              kind={netbirdChallenge ? "netbird" : "tailscaleCheck"}
              url={checkUrl}
              code={netbirdChallenge?.userCode}
              onCancel={onDismiss}
            />
          ) : setupNetbird ? (
            <NetbirdSetup key={connectionId ?? sessionId} connectionId={connectionId} onSubmit={setupNetbird} />
          ) : showIdentityPick ? (
            <IdentityUnavailablePanel
              issue={identityPick}
              onChoose={pickIsHere ? () => setChoosing(true) : undefined}
              onUseHost={pickIsHere ? onUseHostCredential : undefined}
              onCancel={onDismiss}
            />
          ) : showChooser ? (
            <AuthPromptPanel
              vaultId={vaultId}
              connectionId={connectionId}
              hostName={name}
              initialMode="identity"
              repairVia={identityPick.via}
              onSubmit={(override, save) => onRetryWithAuth?.(override, save)}
              onCancel={onDismiss}
            />
          ) : showVaultError && vaultCode ? (
            <VaultErrorPanel code={vaultCode} onRetry={onRetry} onCancel={onDismiss} />
          ) : showPassphrasePrompt ? (
            <PassphrasePromptPanel
              onSubmit={onRetryWithPassphrase}
              onCancel={onDismiss}
            />
          ) : showUsernamePrompt ? (
            <UsernamePromptPanel
              vaultId={vaultId}
              connectionId={connectionId}
              hostName={name}
              onSubmit={(override, save) => onRetryWithAuth?.(override, save)}
              onCancel={onDismiss}
            />
          ) : showAuthPrompt ? (
            <AuthPromptPanel
              vaultId={vaultId}
              connectionId={connectionId}
              hostName={name}
              onSubmit={(override, save) => onRetryWithAuth?.(override, save)}
              onCancel={onDismiss}
            />
          ) : (
            <>
              <ConnectionSteps steps={steps} />

              {isConnecting && reconnectWait && (
                <ReconnectWaitPanel wait={reconnectWait} onRetryNow={onRetryNow} onDismiss={onDismiss} />
              )}

              {isError && (
                <ConnectionErrorPanel
                  errorMessage={errorMessage}
                  retryLabel={legacyFix && t("terminal.overlay.connectionError.enableLegacyAndRetry")}
                  onRetry={legacyFix ?? onRetry}
                  onDismiss={onDismiss}
                />
              )}
            </>
          )}
        </div>
      </div>
    </DismissBlockedContext.Provider>
  );
}
