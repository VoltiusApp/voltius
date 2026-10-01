import { useEffect, useState } from "react";
import { ConnectionHeader } from "./ConnectionHeader";
import { ConnectionErrorPanel, ReconnectWaitPanel } from "./ConnectionStatusPanel";
import { ConnectionSteps } from "./ConnectionSteps";
import { HostKeyConflictPanel } from "./HostKeyConflictPanel";
import { IdentityUnavailablePanel } from "./IdentityUnavailablePanel";
import { PassphrasePromptPanel } from "./PassphrasePromptPanel";
import { AuthPromptPanel } from "./AuthPromptPanel";
import { UsernamePromptPanel } from "./UsernamePromptPanel";
import { VaultErrorPanel } from "./VaultErrorPanel";
import { useConnectionSteps, useHostKeyConflict } from "./hooks";
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
  className,
  onDismiss,
  onRetry,
  reconnectWait,
  onRetryNow,
  onRetryWithPassphrase,
  onRetryWithAuth,
  identityPick,
  onUseHostCredential,
}: ConnectionOverlayProps) {
  const { steps, visible } = useConnectionSteps({ status, stepConfigs, stepEventName });
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
  const showSpecialPanel =
    (conflict && !isError) || showIdentityPick || showChooser || showVaultError || showPassphrasePrompt || showUsernamePrompt || showAuthPrompt;

  return (
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
                onRetry={onRetry}
                onDismiss={onDismiss}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
