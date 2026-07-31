import {
  selectEffectiveSyncStatus,
  sanitizeGistSyncState,
  __resetGistSyncStateWarnings,
  NOT_CONFIGURED_GIST_STATE,
} from "./syncStatus.ts";
import { test, describe, expect, vi, beforeEach, afterEach } from "vitest";

test("syncStatus", async () => {
function eq<T>(a: T, e: T, m: string) { if (JSON.stringify(a) !== JSON.stringify(e)) { console.error(`FAIL ${m}: expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`); throw new Error(m); } console.log(`PASS ${m}`); }

const V = { status: "success" as const, lastSync: null, error: null };
const G = { status: "error" as const, lastSync: null, error: "boom", configured: true };

// Pro server account → Voltius engine wins regardless of gist.
eq(selectEffectiveSyncStatus({ voltius: V, gist: G, accountMode: "server", isPro: true, gistPluginEnabled: true }).status, "success", "server+pro shows voltius");
// No server account but gist configured → gist engine.
eq(selectEffectiveSyncStatus({ voltius: V, gist: G, accountMode: "local", isPro: false, gistPluginEnabled: true }).status, "error", "gist-only shows gist");
eq(selectEffectiveSyncStatus({ voltius: V, gist: G, accountMode: "local", isPro: false, gistPluginEnabled: true }).configured, true, "gist configured");
// Nothing configured → not configured, falls back to voltius state.
eq(selectEffectiveSyncStatus({ voltius: V, gist: { ...G, configured: false }, accountMode: "local", isPro: false, gistPluginEnabled: false }).configured, false, "nothing configured");
});

describe("sanitizeGistSyncState", () => {
  beforeEach(() => {
    __resetGistSyncStateWarnings();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  const valid = {
    status: "success",
    lastSync: new Date("2026-01-01T00:00:00.000Z"),
    error: null,
    blobSizeBytes: 1024,
    configured: true,
  };

  test("passes through an already-valid shape unchanged", () => {
    expect(sanitizeGistSyncState(valid, "plugin-gist-sync")).toEqual(valid);
  });

  test("coerces an ISO-8601 string lastSync to a Date", () => {
    const raw = { ...valid, lastSync: "2026-01-01T00:00:00.000Z" };
    const result = sanitizeGistSyncState(raw, "plugin-gist-sync");
    expect(result.lastSync).toBeInstanceOf(Date);
    expect(result.lastSync?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  test("coerces an epoch-ms number lastSync to a Date", () => {
    const raw = { ...valid, lastSync: 1767225600000 };
    const result = sanitizeGistSyncState(raw, "plugin-gist-sync");
    expect(result.lastSync).toBeInstanceOf(Date);
    expect(result.lastSync?.getTime()).toBe(1767225600000);
  });

  test("rejects a garbage string lastSync to null, never throws", () => {
    const raw = { ...valid, lastSync: "not-a-date" };
    expect(() => sanitizeGistSyncState(raw, "plugin-gist-sync")).not.toThrow();
    expect(sanitizeGistSyncState(raw, "plugin-gist-sync").lastSync).toBeNull();
  });

  test("rejects a NaN Date lastSync to null", () => {
    const raw = { ...valid, lastSync: new Date(NaN) };
    expect(sanitizeGistSyncState(raw, "plugin-gist-sync").lastSync).toBeNull();
  });

  test("rejects an object/boolean lastSync to null", () => {
    expect(sanitizeGistSyncState({ ...valid, lastSync: {} }, "plugin-gist-sync").lastSync).toBeNull();
    expect(sanitizeGistSyncState({ ...valid, lastSync: true }, "plugin-gist-sync").lastSync).toBeNull();
  });

  test("null lastSync stays null without warning", () => {
    expect(sanitizeGistSyncState({ ...valid, lastSync: null }, "plugin-gist-sync").lastSync).toBeNull();
    expect(console.warn).not.toHaveBeenCalled();
  });

  test("invalid status falls back to idle", () => {
    expect(sanitizeGistSyncState({ ...valid, status: "bogus" }, "plugin-gist-sync").status).toBe("idle");
  });

  test("invalid error type falls back to null", () => {
    expect(sanitizeGistSyncState({ ...valid, error: 42 }, "plugin-gist-sync").error).toBeNull();
  });

  test("invalid blobSizeBytes (string, NaN) falls back to null", () => {
    expect(sanitizeGistSyncState({ ...valid, blobSizeBytes: "big" }, "plugin-gist-sync").blobSizeBytes).toBeNull();
    expect(sanitizeGistSyncState({ ...valid, blobSizeBytes: NaN }, "plugin-gist-sync").blobSizeBytes).toBeNull();
  });

  test("invalid configured type falls back to false", () => {
    expect(sanitizeGistSyncState({ ...valid, configured: "yes" }, "plugin-gist-sync").configured).toBe(false);
  });

  test("null, undefined, and a bare object never throw and degrade to not-configured", () => {
    expect(() => sanitizeGistSyncState(null, "plugin-gist-sync")).not.toThrow();
    expect(() => sanitizeGistSyncState(undefined, "plugin-gist-sync")).not.toThrow();
    expect(sanitizeGistSyncState({}, "plugin-gist-sync")).toEqual({
      status: "idle",
      lastSync: null,
      error: null,
      blobSizeBytes: null,
      configured: false,
    });
  });

  test("warns once per plugin+field, not once per call", () => {
    sanitizeGistSyncState({ ...valid, lastSync: "garbage" }, "plugin-gist-sync");
    sanitizeGistSyncState({ ...valid, lastSync: "garbage" }, "plugin-gist-sync");
    sanitizeGistSyncState({ ...valid, lastSync: "garbage" }, "plugin-gist-sync");
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  test("warning dedupe is scoped per plugin id", () => {
    sanitizeGistSyncState({ ...valid, lastSync: "garbage" }, "plugin-a");
    sanitizeGistSyncState({ ...valid, lastSync: "garbage" }, "plugin-b");
    expect(console.warn).toHaveBeenCalledTimes(2);
  });

  // A null-prototype lastSync has no Object.prototype.toString to fall back to —
  // String(x) on it throws TypeError: Cannot convert object to primitive value,
  // right where the warn message is built. This must not escape as a render-time
  // crash; only the lastSync field degrades, the rest of the shape survives.
  test("a null-prototype lastSync never throws (unstringifiable value in the warn message)", () => {
    const raw = { ...valid, lastSync: Object.create(null) };
    expect(() => sanitizeGistSyncState(raw, "plugin-gist-sync")).not.toThrow();
    expect(sanitizeGistSyncState(raw, "plugin-gist-sync")).toEqual({ ...valid, lastSync: null });
  });

  test("an error field with a throwing toString never throws", () => {
    const raw = { ...valid, error: { toString() { throw new Error("boom"); } } };
    expect(() => sanitizeGistSyncState(raw, "plugin-gist-sync")).not.toThrow();
    expect(sanitizeGistSyncState(raw, "plugin-gist-sync").error).toBeNull();
  });

  test("a status field with a throwing Symbol.toPrimitive never throws", () => {
    const raw = { ...valid, status: { [Symbol.toPrimitive]() { throw new Error("boom"); } } };
    expect(() => sanitizeGistSyncState(raw, "plugin-gist-sync")).not.toThrow();
    expect(sanitizeGistSyncState(raw, "plugin-gist-sync").status).toBe("idle");
  });

  test("a blobSizeBytes/configured field that throws when stringified never throws", () => {
    const rawBlob = { ...valid, blobSizeBytes: { toString() { throw new Error("boom"); } } };
    expect(() => sanitizeGistSyncState(rawBlob, "plugin-gist-sync")).not.toThrow();
    expect(sanitizeGistSyncState(rawBlob, "plugin-gist-sync").blobSizeBytes).toBeNull();

    const rawConfigured = { ...valid, configured: { toString() { throw new Error("boom"); } } };
    expect(() => sanitizeGistSyncState(rawConfigured, "plugin-gist-sync")).not.toThrow();
    expect(sanitizeGistSyncState(rawConfigured, "plugin-gist-sync").configured).toBe(false);
  });

  // Unlike the String()-at-the-warn-message vectors above, a throwing getter (or a
  // Proxy `get` trap) throws the moment the field is READ — before any validation
  // logic runs — so the whole object degrades to the not-configured default rather
  // than just that field, same as `raw` not being an object at all.
  test("a throwing getter (or Proxy get trap) on any field never throws", () => {
    const raw = { ...valid, get configured() { throw new Error("boom"); } };
    expect(() => sanitizeGistSyncState(raw, "plugin-gist-sync")).not.toThrow();
    expect(sanitizeGistSyncState(raw, "plugin-gist-sync")).toEqual(NOT_CONFIGURED_GIST_STATE);
  });
});
