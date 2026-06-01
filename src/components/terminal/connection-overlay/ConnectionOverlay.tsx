import { ConnectionHeader } from "./ConnectionHeader";
import { ConnectionErrorPanel, ConnectionLostPanel } from "./ConnectionStatusPanel";
import { ConnectionSteps } from "./ConnectionSteps";
import { HostKeyConflictPanel } from "./HostKeyConflictPanel";
import { PassphrasePromptPanel } from "./PassphrasePromptPanel";
import { useConnectionSteps, useHostKeyConflict } from "./hooks";
import type { ConnectionOverlayProps } from "./types";
import { isPassphraseError } from "./utils";

export default function ConnectionOverlay({
  sessionId,
  status,
  errorMessage,
  name,
  subtitle,
  icon,
  steps: stepConfigs,
  stepEventName,
  conflictEventName,
  className,
  onDismiss,
  onRetry,
  onRetryWithPassphrase,
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
  const showPassphrasePrompt = isError && isPassphraseError(errorMessage) && !!onRetryWithPassphrase;
  const showSpecialPanel = (conflict && !isError) || showPassphrasePrompt;

  return (
    <div className={className ?? "absolute inset-0 z-20 flex items-center justify-center bg-[var(--t-bg-terminal)]"}>
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
        ) : showPassphrasePrompt ? (
          <PassphrasePromptPanel
            onSubmit={onRetryWithPassphrase}
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
