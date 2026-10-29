import { describe, test, expect, vi } from "vitest";
import type { TFunction } from "i18next";
import type { EffectiveSync } from "./syncProviders";

vi.mock("@/utils/localeFormat", () => ({
  HOUR_MINUTE: "hour-minute",
  formatTime: (_d: Date, format: string = "with-seconds") => format,
}));

import { INACTIVE_SYNC_ROWS, syncFailureReason, syncStatusLabel, syncStatusTooltip } from "./syncStatusText";

const t = ((key: string, opts?: Record<string, unknown>) => (opts ? `${key} ${JSON.stringify(opts)}` : key)) as unknown as TFunction;

const effective = (over: Partial<EffectiveSync>): EffectiveSync => ({
  configured: true, paused: false, status: "idle", lastSync: null, error: null, errorSource: null, nearby: 0, ...over,
});

describe("syncStatusLabel", () => {
  test("names every status", () => {
    expect(syncStatusLabel(t, "syncing", null)).toBe("layout.sync.status.syncing");
    expect(syncStatusLabel(t, "success", null)).toBe("layout.sync.status.synced");
    expect(syncStatusLabel(t, "error", null)).toBe("layout.sync.status.error");
    expect(syncStatusLabel(t, "offline", null)).toBe("layout.sync.status.offline");
    expect(syncStatusLabel(t, "idle", null)).toBe("layout.sync.status.idle");
  });

  test("a finished sync carries its time, to the minute", () => {
    expect(syncStatusLabel(t, "success", new Date())).toBe('layout.sync.status.syncedAt {"time":"hour-minute"}');
  });
});

describe("syncFailureReason", () => {
  test("only a failing or unreachable sync has a reason", () => {
    expect(syncFailureReason("error", "token expired")).toBe("token expired");
    expect(syncFailureReason("offline", "connection refused")).toBe("connection refused");
    expect(syncFailureReason("success", "stale")).toBeNull();
    expect(syncFailureReason("syncing", "stale")).toBeNull();
    expect(syncFailureReason("offline", null)).toBeNull();
  });
});

describe("syncStatusTooltip", () => {
  test("a paused device reads as paused, an unset one as not configured", () => {
    expect(syncStatusTooltip(t, effective({ configured: false, paused: true }), "idle")).toBe("layout.sync.status.paused");
    expect(syncStatusTooltip(t, effective({ configured: false }), "idle")).toBe("layout.sync.status.notConfigured");
  });

  test("an error names its reason and its source", () => {
    expect(syncStatusTooltip(t, effective({ error: "boom" }), "error")).toBe('layout.sync.status.errorDetail {"error":"boom"}');
    expect(syncStatusTooltip(t, effective({ error: "boom", errorSource: "Gist" }), "error"))
      .toBe('layout.sync.status.errorDetailFrom {"source":"Gist","error":"boom"}');
    expect(syncStatusTooltip(t, effective({}), "error")).toBe('layout.sync.status.errorDetail {"error":"layout.sync.status.unknown"}');
  });

  test("an unreachable server carries the reason when there is one", () => {
    expect(syncStatusTooltip(t, effective({ error: "refused" }), "offline")).toBe('layout.sync.status.offlineDetail {"error":"refused"}');
    expect(syncStatusTooltip(t, effective({}), "offline")).toBe("layout.sync.status.offline");
  });

  test("a finished sync carries its time, to the second", () => {
    expect(syncStatusTooltip(t, effective({ lastSync: new Date() }), "success")).toBe('layout.sync.status.syncedAt {"time":"with-seconds"}');
  });

  test("the other statuses reuse the label, except idle", () => {
    expect(syncStatusTooltip(t, effective({}), "syncing")).toBe("layout.sync.status.syncing");
    expect(syncStatusTooltip(t, effective({}), "success")).toBe("layout.sync.status.synced");
    expect(syncStatusTooltip(t, effective({}), "idle")).toBe("layout.sync.status.default");
  });
});

test("every availability that is neither active nor locked has an inactive row", () => {
  expect(Object.keys(INACTIVE_SYNC_ROWS).sort()).toEqual(["disabled", "needs_upgrade", "not_configured", "paused"]);
});
