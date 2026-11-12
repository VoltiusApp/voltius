// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

type Reply = number | "network" | "lost" | { status: number; retryAfter: string };
interface Sent {
  url: string;
  body: Record<string, unknown> & { event_id: string; occurred_at: string; action: string };
  at: number;
}

const session = { accountId: "acct-a" as string | null, serverUrl: "https://srv.test" as string | null };
const script: Reply[] = [];
const sent: Sent[] = [];
const stored = new Map<string, Sent["body"]>();
let networkBack: (() => void) | null = null;

vi.mock("@/services/authTokens", () => ({
  getAccountId: async () => session.accountId,
  getServerUrl: async () => session.serverUrl,
}));
vi.mock("@/lib/logger", () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("@/lib/networkSignals", () => ({
  onNetworkBack: (fn: () => void) => {
    networkBack = fn;
    return () => { networkBack = null; };
  },
}));
vi.mock("@/services/authFetch", () => ({
  fetchAuthJson: async (url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as Sent["body"];
    sent.push({ url, body, at: Date.now() });
    const reply = script.shift() ?? 204;
    if (reply === "network") throw new Error("offline");
    if (reply === "lost") {
      if (!stored.has(body.event_id)) stored.set(body.event_id, body);
      throw new Error("connection reset");
    }
    if (typeof reply === "object") return new Response(null, { status: reply.status, headers: { "Retry-After": reply.retryAfter } });
    if (reply >= 200 && reply < 300 && !stored.has(body.event_id)) stored.set(body.event_id, body);
    return new Response(null, { status: reply });
  },
}));

const outbox = await import("./auditOutbox");
const {
  AUDIT_OUTBOX_KEY, BASE_BACKOFF_MS, MAX_AGE_MS, MAX_BACKOFF_MS, MAX_EVENT_CHARS, MAX_PENDING,
  MAX_PENDING_CHARS, MAX_SERVER_ERRORS, PACE_MS, enqueueAuditEvent, getAuditOutboxStats, resetAuditOutboxForTests, startAuditOutbox,
} = outbox;

const event = (action = "connection.started", occurred_at = new Date().toISOString()) =>
  ({ action, occurred_at }) as Parameters<typeof enqueueAuditEvent>[1];

const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);
const persisted = () => JSON.parse(localStorage.getItem(AUDIT_OUTBOX_KEY) ?? "{}");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(new Date("2026-11-12T10:00:00Z"));
  localStorage.clear();
  script.length = 0;
  sent.length = 0;
  stored.clear();
  session.accountId = "acct-a";
  session.serverUrl = "https://srv.test";
  resetAuditOutboxForTests();
});

afterEach(() => {
  resetAuditOutboxForTests();
  vi.useRealTimers();
});

describe("delivery", () => {
  test("a delivered event leaves the queue and reaches the team endpoint with its id and timestamp", async () => {
    await enqueueAuditEvent("team-1", event("secret.viewed", "2026-11-12T09:59:00.000Z"));
    await settle();

    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("https://srv.test/v1/teams/team-1/audit-logs/client");
    expect(sent[0].body).toMatchObject({ action: "secret.viewed", occurred_at: "2026-11-12T09:59:00.000Z" });
    expect(sent[0].body.event_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(getAuditOutboxStats()).toEqual({ pending: 0, failed: 0, dropped: 0 });
  });

  test("a network failure keeps the event and delivers it after the backoff", async () => {
    script.push("network");
    await enqueueAuditEvent("team-1", event());
    await settle();
    expect(getAuditOutboxStats().pending).toBe(1);

    await settle(BASE_BACKOFF_MS);
    expect(stored.size).toBe(1);
    expect(getAuditOutboxStats().pending).toBe(0);
  });

  test("a lost response after the server committed is retried with the same id and stored once", async () => {
    script.push("lost");
    await enqueueAuditEvent("team-1", event());
    await settle();
    await settle(BASE_BACKOFF_MS);

    expect(sent).toHaveLength(2);
    expect(sent[1].body.event_id).toBe(sent[0].body.event_id);
    expect(stored.size).toBe(1);
    expect(getAuditOutboxStats().pending).toBe(0);
  });

  test("a 429 waits out Retry-After before trying again", async () => {
    script.push({ status: 429, retryAfter: "30" });
    await enqueueAuditEvent("team-1", event());
    await settle();
    await settle(29_000);
    expect(sent).toHaveLength(1);

    await settle(1_000);
    expect(sent).toHaveLength(2);
    expect(getAuditOutboxStats().pending).toBe(0);
  });

  test.each([500, 502, 503, 504])("a %i is retried until it succeeds", async (status) => {
    script.push(status, status);
    await enqueueAuditEvent("team-1", event());
    await settle();
    await settle(BASE_BACKOFF_MS);
    await settle(BASE_BACKOFF_MS * 2);

    expect(sent).toHaveLength(3);
    expect(stored.size).toBe(1);
  });

  test("a new event does not jump a pending retry delay", async () => {
    script.push(503);
    await enqueueAuditEvent("team-1", event("connection.started"));
    await settle();
    await enqueueAuditEvent("team-1", event("connection.ended"));
    await settle();
    expect(sent).toHaveLength(1);

    await settle(BASE_BACKOFF_MS + PACE_MS);
    expect(sent.map((s) => s.body.action)).toEqual(["connection.started", "connection.started", "connection.ended"]);
  });

  test("the network coming back retries at once", async () => {
    startAuditOutbox();
    script.push("network");
    await enqueueAuditEvent("team-1", event());
    await settle();

    networkBack?.();
    await settle();
    expect(stored.size).toBe(1);
  });

  test("events go in order, keep their own timestamps and are paced", async () => {
    script.push("network");
    for (const minute of ["01", "02", "03"]) {
      await enqueueAuditEvent("team-1", event("connection.started", `2026-11-12T09:${minute}:00.000Z`));
    }
    await settle(BASE_BACKOFF_MS + 3 * PACE_MS);

    const delivered = sent.slice(1);
    expect(delivered.map((s) => s.body.occurred_at)).toEqual([
      "2026-11-12T09:01:00.000Z",
      "2026-11-12T09:02:00.000Z",
      "2026-11-12T09:03:00.000Z",
    ]);
    expect(delivered[1].at - delivered[0].at).toBeGreaterThanOrEqual(PACE_MS);
    expect(delivered[2].at - delivered[1].at).toBeGreaterThanOrEqual(PACE_MS);
  });

  test("events pending at the last shutdown are sent on start", async () => {
    script.push("network");
    await enqueueAuditEvent("team-1", event("connection.started", "2026-11-12T09:00:00.000Z"));
    await settle();
    resetAuditOutboxForTests();
    sent.length = 0;

    startAuditOutbox();
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0].body.occurred_at).toBe("2026-11-12T09:00:00.000Z");
    expect(getAuditOutboxStats().pending).toBe(0);
  });

  test("backoff is capped", async () => {
    for (let i = 0; i < 20; i++) script.push("network");
    await enqueueAuditEvent("team-1", event());
    for (let i = 0; i < 12; i++) await settle(MAX_BACKOFF_MS);
    const gaps = sent.slice(1).map((s, i) => s.at - sent[i].at);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(MAX_BACKOFF_MS);
    expect(getAuditOutboxStats().pending).toBe(1);
  });
});

describe("permanent failures", () => {
  test.each([400, 403, 404, 413, 422])("a %i is not retried and the next event still goes", async (status) => {
    script.push(status);
    await enqueueAuditEvent("team-1", event("connection.started"));
    await enqueueAuditEvent("team-1", event("connection.ended"));
    await settle(PACE_MS * 2);

    expect(sent.map((s) => s.body.action)).toEqual(["connection.started", "connection.ended"]);
    expect(persisted().failed).toMatchObject([{ action: "connection.started", reason: status }]);
    await settle(MAX_BACKOFF_MS);
    expect(sent).toHaveLength(2);
  });

  test("an event the server keeps failing on stops after a bounded number of tries", async () => {
    for (let i = 0; i < MAX_SERVER_ERRORS + 5; i++) script.push(500);
    await enqueueAuditEvent("team-1", event());
    for (let i = 0; i < MAX_SERVER_ERRORS + 2; i++) await settle(MAX_BACKOFF_MS);

    expect(sent).toHaveLength(MAX_SERVER_ERRORS);
    expect(getAuditOutboxStats()).toMatchObject({ pending: 0, failed: 1 });
    expect(persisted().failed[0].reason).toBe(500);
  });

  test("an event older than the retention window is given up as expired", async () => {
    script.push("network");
    await enqueueAuditEvent("team-1", event("connection.started", new Date(Date.now() - MAX_AGE_MS - 1).toISOString()));
    await settle();

    expect(sent).toHaveLength(0);
    expect(persisted().failed).toMatchObject([{ reason: "expired" }]);
  });
});

describe("account scoping", () => {
  test("nothing is queued without a signed-in server account", async () => {
    session.serverUrl = null;
    await enqueueAuditEvent("team-1", event());
    expect(getAuditOutboxStats().pending).toBe(0);
  });

  test("events queued under one account are never sent with another's session", async () => {
    script.push("network");
    await enqueueAuditEvent("team-1", event());
    await settle();

    session.accountId = "acct-b";
    await settle(BASE_BACKOFF_MS);
    expect(sent).toHaveLength(1);
    expect(getAuditOutboxStats()).toMatchObject({ pending: 0, dropped: 1 });
  });

  test("events queued for one server are never sent to another", async () => {
    script.push("network");
    await enqueueAuditEvent("team-1", event());
    await settle();

    session.serverUrl = "https://other.test";
    await settle(BASE_BACKOFF_MS);
    expect(sent).toHaveLength(1);
  });

  test("a signed-out device holds its queue rather than sending", async () => {
    script.push("network");
    await enqueueAuditEvent("team-1", event());
    await settle();

    session.accountId = null;
    await settle(BASE_BACKOFF_MS);
    expect(sent).toHaveLength(1);
    expect(getAuditOutboxStats().pending).toBe(1);
  });
});

describe("limits", () => {
  test("a full queue drops its oldest event and counts it", async () => {
    script.push("network");
    for (let i = 0; i <= MAX_PENDING; i++) {
      await enqueueAuditEvent("team-1", event("connection.started", new Date(Date.UTC(2026, 10, 12, 0, 0, i)).toISOString()));
    }

    expect(getAuditOutboxStats()).toMatchObject({ pending: MAX_PENDING, dropped: 1 });
    expect(persisted().pending[0].event.occurred_at).toBe(new Date(Date.UTC(2026, 10, 12, 0, 0, 1)).toISOString());
  }, 30_000);

  test("a queue over its size budget drops its oldest events", async () => {
    script.push("network");
    const metadata = { note: "x".repeat(MAX_EVENT_CHARS / 2) };
    const fits = Math.floor(MAX_PENDING_CHARS / JSON.stringify(metadata).length);
    for (let i = 0; i < fits + 5; i++) await enqueueAuditEvent("team-1", { ...event(), metadata });

    expect(JSON.stringify(persisted().pending).length).toBeLessThanOrEqual(MAX_PENDING_CHARS);
    expect(getAuditOutboxStats().dropped).toBeGreaterThan(0);
  }, 30_000);

  test("an oversized event is refused instead of queued", async () => {
    await enqueueAuditEvent("team-1", { ...event(), metadata: { blob: "x".repeat(MAX_EVENT_CHARS) } });
    await settle();

    expect(sent).toHaveLength(0);
    expect(persisted().failed).toMatchObject([{ reason: "too_large" }]);
  });

  test("a corrupt queue reads as empty", async () => {
    localStorage.setItem(AUDIT_OUTBOX_KEY, "{not json");
    expect(getAuditOutboxStats()).toEqual({ pending: 0, failed: 0, dropped: 0 });
  });
});

test("whatever the server does, every event ends up stored once or recorded as failed, never lost", async () => {
  let seed = 7;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const replies: Reply[] = [204, 204, "network", "lost", 429, 500, 503, 403, 400];
  for (let round = 0; round < 25; round++) {
    localStorage.clear();
    stored.clear();
    sent.length = 0;
    script.length = 0;
    resetAuditOutboxForTests();
    for (let i = 0; i < 60; i++) script.push(replies[Math.floor(random() * replies.length)]);

    const count = 1 + Math.floor(random() * 8);
    for (let i = 0; i < count; i++) {
      await enqueueAuditEvent("team-1", event("connection.started", new Date(Date.now() - i * 1000).toISOString()));
      await settle(Math.floor(random() * 3) * PACE_MS);
    }
    for (let i = 0; i < 30 && getAuditOutboxStats().pending > 0; i++) await settle(MAX_BACKOFF_MS);

    const ids = new Set(sent.map((s) => s.body.event_id));
    const failed = new Set((persisted().failed as { id: string }[]).map((f) => f.id));
    expect(getAuditOutboxStats().pending).toBe(0);
    expect(ids.size).toBe(count);
    for (const id of ids) expect(stored.has(id) || failed.has(id)).toBe(true);
  }
});
