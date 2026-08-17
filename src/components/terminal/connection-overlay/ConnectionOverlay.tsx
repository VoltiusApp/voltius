import { ConnectionHeader } from "./ConnectionHeader";
import { ConnectionErrorPanel, ConnectionLostPanel } from "./ConnectionStatusPanel";
import { ConnectionSteps } from "./ConnectionSteps";
import { HostKeyConflictPanel } from "./HostKeyConflictPanel";
import { PassphrasePromptPanel } from "./PassphrasePromptPanel";
import { AuthPromptPanel } from "./AuthPromptPanel";
import { UsernamePromptPanel } from "./UsernamePromptPanel";
import { VaultErrorPanel } from "./VaultErrorPanel";
import { useConnectionSteps, useHostKeyConflict } from "./hooks";
import type { ConnectionOverlayProps } from "./types";
import { isMissingUsernameError, isNoAuthError, isPassphraseError } from "./utils";

export default function ConnectionOverlay({
  sessionId,
  status,
  errorMessage,
  errorCode,
  name,
  subtitle,
  icon,
  vaultId,
  steps: stepConfigs,
  stepEventName,
  conflictEventName,
  className,
  onDismiss,
  onRetry,
  onRetryWithPassphrase,
  onRetryWithAuth,
}: ConnectionOverlayProps) {
  const { steps, visible } = useConnectionSteps({ status, stepConfigs, stepEventName });
  const { conflict, resolving, resolveConflict } = useHostKeyConflict({
    sessionId,
    status,
    conflictEventName,
  });

  if (!visible) return null;

  const isError = status === "error";
  const isDisconnected = status === "disconnected";
  const isConnecting = status === "connecting";
  // Outranks the message-based prompts: the credentials are stored, just unreadable.
  const showVaultError = isError && !!errorCode;
  const showPassphrasePrompt = isError && !showVaultError && isPassphraseError(errorMessage) && !!onRetryWithPassphrase;
  const showUsernamePrompt = isError && !showVaultError && isMissingUsernameError(errorMessage) && !!onRetryWithAuth;
  const showAuthPrompt = isError && !showVaultError && isNoAuthError(errorMessage) && !!onRetryWithAuth;
  const showSpecialPanel =
    (conflict && !isError) || showVaultError || showPassphrasePrompt || showUsernamePrompt || showAuthPrompt;

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
        ) : showVaultError ? (
          <VaultErrorPanel code={errorCode} onRetry={onRetry} onCancel={onDismiss} />
        ) : showPassphrasePrompt ? (
          <PassphrasePromptPanel
            onSubmit={onRetryWithPassphrase}
            onCancel={onDismiss}
          />
        ) : showUsernamePrompt ? (
          <UsernamePromptPanel
            vaultId={vaultId}
            onSubmit={(override, save) => onRetryWithAuth?.(override, save)}
            onCancel={onDismiss}
          />
        ) : showAuthPrompt ? (
          <AuthPromptPanel
            vaultId={vaultId}
            onSubmit={(override, save) => onRetryWithAuth?.(override, save)}
            onCancel={onDismiss}
          />
        ) : (
          <>
            <ConnectionSteps steps={steps} />

            {isDisconnected && <ConnectionLostPanel />}

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
