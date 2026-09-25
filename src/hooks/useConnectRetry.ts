import { useCallback, useEffect, useRef } from "react";
import { connectRetryDelay } from "@/stores/reconnectBackoffCore";
import type { VaultErrorCode } from "@/services/vaultErrors";

type RetryPhase = { tag: string; message?: string; errorCode?: VaultErrorCode };

/** Re-run `retry` on the reconnect backoff schedule while `phase` is an error.
 *  Wrong credentials, a rejected host key or a locked vault stop it at once, and
 *  a failure that keeps coming back stops it once the schedule is spent — both
 *  leave the error up for the user. Any phase other than connecting/error
 *  starts the next failure on a fresh schedule; `reset` does so explicitly.
 *  `retrying` says whether another attempt is coming. */
export function useConnectRetry(phase: RetryPhase, retry: () => void): { retrying: boolean; reset: () => void } {
  const attempt = useRef(0);
  const retryRef = useRef(retry);
  retryRef.current = retry;

  if (phase.tag !== "error" && phase.tag !== "connecting") attempt.current = 0;
  const delay = phase.tag === "error" ? connectRetryDelay(attempt.current, phase.message, phase.errorCode) : null;

  useEffect(() => {
    if (delay === null) return;
    const t = setTimeout(() => { attempt.current++; retryRef.current(); }, delay);
    return () => clearTimeout(t);
  }, [phase, delay]);

  const reset = useCallback(() => { attempt.current = 0; }, []);
  return { retrying: delay !== null, reset };
}
