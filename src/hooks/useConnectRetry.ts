import { useCallback, useEffect, useRef } from "react";
import { connectRetryDelay, STABLE_CONNECTION_MS } from "@/stores/reconnectBackoffCore";
import type { VaultErrorCode } from "@/services/vaultErrors";

type RetryPhase = { tag: string; message?: string; errorCode?: VaultErrorCode };

/** Re-run `retry` on the reconnect backoff while `phase` is a retryable error. The schedule
 *  restarts for a new `target`, on `reset`, or once a connection has held for a while. */
export function useConnectRetry(phase: RetryPhase, retry: () => void, target: unknown): { retrying: boolean; reset: () => void } {
  const attempt = useRef(0);
  const lastTarget = useRef(target);
  const retryRef = useRef(retry);
  retryRef.current = retry;

  if (lastTarget.current !== target) {
    lastTarget.current = target;
    attempt.current = 0;
  }
  const delay = phase.tag === "error" ? connectRetryDelay(attempt.current, phase.message, phase.errorCode) : null;

  useEffect(() => {
    if (delay === null) return;
    const t = setTimeout(() => { attempt.current++; retryRef.current(); }, delay);
    return () => clearTimeout(t);
  }, [phase, delay]);

  // Resetting on every connect would retry a host that accepts and then drops at once every 1.5 s forever.
  useEffect(() => {
    if (phase.tag !== "connected") return;
    const t = setTimeout(() => { attempt.current = 0; }, STABLE_CONNECTION_MS);
    return () => clearTimeout(t);
  }, [phase.tag]);

  const reset = useCallback(() => { attempt.current = 0; }, []);
  return { retrying: delay !== null, reset };
}
