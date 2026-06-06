export function ConnectionLostPanel() {
  return (
    <div className="w-full p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-center">
      <p className="text-yellow-400 text-sm font-medium">Connection lost</p>
      <p className="text-text-muted text-xs mt-1">Reconnecting…</p>
    </div>
  );
}

export function ConnectionErrorPanel({
  errorMessage,
  onRetry,
  onDismiss,
}: {
  errorMessage?: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}) {
  return (
    <div className="w-full p-3 rounded-lg bg-red-600/10 border border-red-600/20">
      <p className="text-status-error text-sm font-medium">Connection failed</p>
      {errorMessage && (
        <p className="text-status-error/80 text-xs mt-1 wrap-break-word">{errorMessage}</p>
      )}
      <div className="mt-2 flex items-center gap-3 justify-center">
        {onRetry && (
          <button
            onClick={onRetry}
            className="text-xs text-accent hover:text-accent/80 transition-colors underline"
          >
            Retry
          </button>
        )}
        <button
          onClick={onDismiss}
          className="text-xs text-text-muted hover:text-text-primary transition-colors underline"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
