import { log } from "@/lib/logger";
import { onNetworkBack } from "@/lib/networkSignals";
import { fetchAuthJson } from "@/services/authFetch";
import { getAccountId, getServerUrl } from "@/services/authTokens";
import type { AnyAuditAction } from "@/services/auditContext";

export interface ClientAuditEvent {
  action: AnyAuditAction;
  vault_id?: string;
  target_type?: string;
  target_id?: string;
  target_name?: string;
  metadata?: Record<string, unknown>;
  occurred_at: string;
}

interface PendingEvent {
  id: string;
  accountId: string;
  serverUrl: string;
  teamId: string;
  event: ClientAuditEvent;
  serverErrors: number;
}

export type FailureReason = number | "expired" | "too_large";

interface FailedEvent {
  id: string;
  teamId: string;
  action: string;
  occurred_at: string;
  reason: FailureReason;
}

interface Outbox {
  pending: PendingEvent[];
  failed: FailedEvent[];
  dropped: number;
}

export const AUDIT_OUTBOX_KEY = "voltius-audit-outbox";
export const MAX_PENDING = 500;
export const MAX_PENDING_CHARS = 256_000;
export const MAX_EVENT_CHARS = 8_000;
export const MAX_FAILED = 50;
export const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_SERVER_ERRORS = 10;
export const PACE_MS = 1_000;
export const BASE_BACKOFF_MS = 5_000;
export const MAX_BACKOFF_MS = 15 * 60 * 1000;

const empty = (): Outbox => ({ pending: [], failed: [], dropped: 0 });

function isPending(v: unknown): v is PendingEvent {
  const e = v as PendingEvent;
  return (
    typeof e === "object" && e !== null &&
    typeof e.id === "string" && typeof e.accountId === "string" &&
    typeof e.serverUrl === "string" && typeof e.teamId === "string" &&
    typeof e.serverErrors === "number" &&
    typeof e.event === "object" && e.event !== null &&
    typeof e.event.action === "string" && typeof e.event.occurred_at === "string"
  );
}

function read(): Outbox {
  try {
    const raw = localStorage.getItem(AUDIT_OUTBOX_KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Partial<Outbox>;
    return {
      pending: Array.isArray(parsed.pending) ? parsed.pending.filter(isPending) : [],
      failed: Array.isArray(parsed.failed) ? parsed.failed : [],
      dropped: typeof parsed.dropped === "number" ? parsed.dropped : 0,
    };
  } catch {
    return empty();
  }
}

function write(outbox: Outbox): void {
  try {
    localStorage.setItem(AUDIT_OUTBOX_KEY, JSON.stringify(outbox));
  } catch (e) {
    log.warn("audit outbox: could not persist", e instanceof Error ? e.message : String(e));
  }
}

function update(fn: (outbox: Outbox) => void): Outbox {
  const outbox = read();
  fn(outbox);
  write(outbox);
  return outbox;
}

function fail(outbox: Outbox, entry: PendingEvent, reason: FailureReason): void {
  outbox.pending = outbox.pending.filter((e) => e.id !== entry.id);
  outbox.failed = [
    ...outbox.failed,
    { id: entry.id, teamId: entry.teamId, action: entry.event.action, occurred_at: entry.event.occurred_at, reason },
  ].slice(-MAX_FAILED);
  log.warn(`audit outbox: ${entry.event.action} for team ${entry.teamId} not delivered`, String(reason));
}

function fitToBudget(outbox: Outbox): void {
  let chars = JSON.stringify(outbox.pending).length;
  while (outbox.pending.length > 1 && (outbox.pending.length > MAX_PENDING || chars > MAX_PENDING_CHARS)) {
    const [oldest] = outbox.pending.splice(0, 1);
    chars -= JSON.stringify(oldest).length + 1;
    outbox.dropped += 1;
    log.warn(`audit outbox full: dropped ${oldest.event.action} from ${oldest.event.occurred_at}`);
  }
}

export function getAuditOutboxStats(): { pending: number; failed: number; dropped: number } {
  const { pending, failed, dropped } = read();
  return { pending: pending.length, failed: failed.length, dropped };
}

export async function enqueueAuditEvent(teamId: string, event: ClientAuditEvent): Promise<void> {
  const [accountId, serverUrl] = await Promise.all([getAccountId(), getServerUrl()]);
  if (!accountId || !serverUrl) return;
  const entry: PendingEvent = { id: crypto.randomUUID(), accountId, serverUrl, teamId, event, serverErrors: 0 };
  update((outbox) => {
    if (JSON.stringify(entry).length > MAX_EVENT_CHARS) return fail(outbox, entry, "too_large");
    outbox.pending.push(entry);
    fitToBudget(outbox);
  });
  kick();
}

type Outcome =
  | { kind: "delivered" }
  | { kind: "rejected"; status: number }
  | { kind: "retry"; serverError?: number; afterMs?: number };

function retryAfterMs(res: Response): number | undefined {
  const seconds = Number(res.headers.get("Retry-After"));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, MAX_BACKOFF_MS) : undefined;
}

async function deliver(entry: PendingEvent): Promise<Outcome> {
  let res: Response;
  try {
    res = await fetchAuthJson(`${entry.serverUrl}/v1/teams/${entry.teamId}/audit-logs/client`, {
      method: "POST",
      body: JSON.stringify({ ...entry.event, event_id: entry.id }),
    });
  } catch {
    return { kind: "retry" };
  }
  if (res.ok) return { kind: "delivered" };
  if (res.status === 429) return { kind: "retry", afterMs: retryAfterMs(res) };
  if (res.status === 401) return { kind: "retry" };
  if (res.status === 408 || res.status >= 500) return { kind: "retry", serverError: res.status, afterMs: retryAfterMs(res) };
  return { kind: "rejected", status: res.status };
}

let running: Promise<void> | null = null;
let rerun = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let notBefore = 0;
let failures = 0;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function schedule(ms: number): void {
  if (timer) clearTimeout(timer);
  notBefore = Date.now() + ms;
  timer = setTimeout(() => {
    timer = null;
    kick();
  }, ms);
}

function nextBackoff(): number {
  const ms = Math.min(BASE_BACKOFF_MS * 2 ** failures, MAX_BACKOFF_MS);
  failures += 1;
  return ms;
}

/** Oldest deliverable entry for this account and server; anything else it holds is dropped or expired on the way. */
function takeNext(accountId: string, serverUrl: string): PendingEvent | undefined {
  let next: PendingEvent | undefined;
  update((outbox) => {
    for (const entry of [...outbox.pending]) {
      if (entry.accountId !== accountId || entry.serverUrl !== serverUrl) {
        outbox.pending = outbox.pending.filter((e) => e.id !== entry.id);
        outbox.dropped += 1;
        log.warn(`audit outbox: dropped ${entry.event.action} queued under another account or server`);
      } else if (Date.now() - Date.parse(entry.event.occurred_at) > MAX_AGE_MS) {
        fail(outbox, entry, "expired");
      } else {
        next = entry;
        return;
      }
    }
  });
  return next;
}

async function run(): Promise<void> {
  for (let sent = 0; ; sent++) {
    if (sent > 0) await sleep(PACE_MS);
    const [accountId, serverUrl] = await Promise.all([getAccountId(), getServerUrl()]);
    if (!accountId || !serverUrl) return;
    const entry = takeNext(accountId, serverUrl);
    if (!entry) return;

    const outcome = await deliver(entry);
    if (outcome.kind === "delivered") {
      failures = 0;
      update((outbox) => {
        outbox.pending = outbox.pending.filter((e) => e.id !== entry.id);
      });
      continue;
    }
    if (outcome.kind === "rejected") {
      update((outbox) => fail(outbox, entry, outcome.status));
      continue;
    }
    const { serverError } = outcome;
    if (serverError) {
      update((outbox) => {
        const live = outbox.pending.find((e) => e.id === entry.id);
        if (!live) return;
        live.serverErrors += 1;
        if (live.serverErrors >= MAX_SERVER_ERRORS) fail(outbox, live, serverError);
      });
    }
    const backoff = nextBackoff();
    schedule(outcome.afterMs ?? backoff);
    return;
  }
}

/** Start a delivery pass unless one is running or a retry is still waiting out its delay. */
export function kick(force = false): Promise<void> {
  if (!force && Date.now() < notBefore) return running ?? Promise.resolve();
  if (force && timer) {
    clearTimeout(timer);
    timer = null;
    notBefore = 0;
  }
  if (running) {
    rerun = true;
    return running;
  }
  running = run()
    .catch((e) => log.warn("audit outbox: delivery pass failed", e instanceof Error ? e.message : String(e)))
    .finally(() => {
      running = null;
      if (rerun) {
        rerun = false;
        void kick();
      }
    });
  return running;
}

let stopListening: (() => void) | null = null;

export function startAuditOutbox(): void {
  if (!stopListening) stopListening = onNetworkBack(() => void kick(true));
  void kick(true);
}

export function resetAuditOutboxForTests(): void {
  if (timer) clearTimeout(timer);
  stopListening?.();
  stopListening = null;
  running = null;
  rerun = false;
  timer = null;
  notBefore = 0;
  failures = 0;
}
