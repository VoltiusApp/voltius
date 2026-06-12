import { backoffDelays, cancelBackoff, handleSessionClosed, runBackoff, type BackoffStore, type SessionStatus } from "./reconnectBackoffCore.ts";

function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`FAIL ${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    throw new Error(msg);
  }
  console.log(`PASS ${msg}`);
}

// --- schedule (pure) ---
const delays = backoffDelays();
assertEqual(delays.slice(0, 4), [1500, 3000, 5000, 8000], "fast initial backoff steps");
assertEqual(delays.every((d) => d <= 10000), true, "no single delay exceeds 10s");
const total = delays.reduce((a, b) => a + b, 0);
assertEqual(total >= 180000, true, "schedule spans at least ~3 minutes to survive an outage");

// --- loop behavior via injected store ---
// Fire timers immediately so the schedule runs without real waits.
const realSetTimeout = globalThis.setTimeout;
// @ts-expect-error test stub
globalThis.setTimeout = (fn: () => void) => { fn(); return 0 as unknown as ReturnType<typeof setTimeout>; };

const interactive = (msg?: string) => msg === "The key is encrypted";

type Attempt = () => Promise<{ ok: boolean; errorMessage?: string }>;

function makeStore(opts: {
  status: () => SessionStatus;
  exists?: () => boolean;
  attempt?: Attempt;
}): BackoffStore & { attempts: number; reconnecting: number; connected: number; errors: string[] } {
  const userAttempt = opts.attempt;
  const s = {
    attempts: 0,
    reconnecting: 0,
    connected: 0,
    errors: [] as string[],
    status: opts.status,
    exists: () => (opts.exists ? opts.exists() : true),
    markReconnecting: () => { s.reconnecting++; },
    markConnected: () => { s.connected++; },
    markError: (_id: string, msg: string) => { s.errors.push(msg); },
    attempt: async () => {
      s.attempts++;
      return userAttempt ? userAttempt() : { ok: false };
    },
    needsInteractiveInput: interactive,
  };
  return s;
}

await (async () => {
  // Recovered elsewhere (e.g. manual retry) before the first wake.
  const store = makeStore({ status: () => "connected" });
  const ok = await runBackoff("s-connected", store);
  assertEqual(ok, true, "returns true when already connected");
  assertEqual(store.attempts, 0, "does not attempt when already connected");
})();

await (async () => {
  const store = makeStore({ status: () => undefined, exists: () => false });
  const ok = await runBackoff("s-gone", store);
  assertEqual(ok, false, "bails false when session is gone");
  assertEqual(store.attempts, 0, "does not attempt when session gone");
})();

await (async () => {
  const store = makeStore({ status: () => "disconnected", attempt: async () => ({ ok: true }) });
  const ok = await runBackoff("s-ok", store);
  assertEqual(ok, true, "returns true once an attempt succeeds");
  assertEqual(store.reconnecting, 1, "marks reconnecting once at the start");
  assertEqual(store.connected, 1, "marks connected on success");
  assertEqual(store.attempts, 1, "stops attempting after success");
})();

await (async () => {
  // Transient failures must stay calm: keep retrying, surface no error.
  let n = 0;
  const store = makeStore({
    status: () => "disconnected",
    attempt: async () => (++n >= 3 ? { ok: true } : { ok: false, errorMessage: "host unreachable" }),
  });
  const ok = await runBackoff("s-transient", store);
  assertEqual(ok, true, "recovers after transient failures");
  assertEqual(store.attempts, 3, "retries through transient failures");
  assertEqual(store.errors, [], "never surfaces a transient error to the overlay");
})();

await (async () => {
  const store = makeStore({
    status: () => "disconnected",
    attempt: async () => ({ ok: false, errorMessage: "The key is encrypted" }),
  });
  const ok = await runBackoff("s-passphrase", store);
  assertEqual(ok, false, "stops on interactive passphrase error");
  assertEqual(store.attempts, 1, "attempts exactly once before bailing on passphrase error");
  assertEqual(store.errors, ["The key is encrypted"], "surfaces the interactive error so the prompt renders");
})();

await (async () => {
  // Network never returns: exhaust the schedule, then surface one final error.
  const store = makeStore({ status: () => "disconnected", attempt: async () => ({ ok: false }) });
  const ok = await runBackoff("s-exhausted", store);
  assertEqual(ok, false, "returns false when the schedule is exhausted");
  assertEqual(store.attempts, delays.length, "attempts once per scheduled delay");
  assertEqual(store.errors.length, 1, "surfaces exactly one error after exhaustion");
})();

await (async () => {
  // Newer loop supersedes the older one; older bails on its next wake.
  const store = makeStore({ status: () => "disconnected" });
  const older = runBackoff("s-dup", store);
  const newer = await runBackoff("s-dup", makeStore({ status: () => "connected" }));
  assertEqual(newer, true, "newer loop runs to completion");
  const olderResult = await older;
  assertEqual(olderResult, false, "older loop bails after being superseded");
})();

await (async () => {
  const store = makeStore({ status: () => "disconnected" });
  const loop = runBackoff("s-cancel", store);
  cancelBackoff("s-cancel");
  const ok = await loop;
  assertEqual(ok, false, "cancelBackoff stops a mid-schedule loop");
  assertEqual(store.attempts, 0, "cancelled loop performs no attempts");
})();

globalThis.setTimeout = realSetTimeout;

// --- handleSessionClosed: start reconnect only on an unexpected close ---
(() => {
  const calls: string[] = [];
  const deps = (status: SessionStatus) => ({
    status: () => status,
    markDisconnected: () => calls.push("disconnect"),
    reconnectWithBackoff: () => calls.push("backoff"),
  });

  calls.length = 0;
  handleSessionClosed("ssh", "s1", deps("connected"));
  assertEqual(calls, ["backoff"], "ssh close on a connected session starts reconnect");

  calls.length = 0;
  handleSessionClosed("serial", "s1", deps("connected"));
  assertEqual(calls, ["backoff"], "serial close on a connected session starts reconnect");

  calls.length = 0;
  handleSessionClosed("ssh", "s1", deps("disconnected"));
  assertEqual(calls, [], "close while already reconnecting is ignored (no second loop)");

  calls.length = 0;
  handleSessionClosed("ssh", "s1", deps("connecting"));
  assertEqual(calls, [], "close mid-connect is ignored");

  calls.length = 0;
  handleSessionClosed("local", "s1", deps("connected"));
  assertEqual(calls, ["disconnect"], "local close marks disconnected without reconnecting");
})();

console.log("ALL TESTS PASSED");
