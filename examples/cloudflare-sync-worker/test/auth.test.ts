import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import worker from "../src/index";
import { timingSafeEqualString, extractBearerToken } from "../src/auth";

describe("auth helpers", () => {
  it("timingSafeEqualString accepts equal secrets", () => {
    expect(timingSafeEqualString("abc", "abc")).toBe(true);
    expect(timingSafeEqualString("abc", "abd")).toBe(false);
    expect(timingSafeEqualString("abc", "ab")).toBe(false);
  });

  it("extractBearerToken parses Authorization header", () => {
    expect(extractBearerToken(new Request("http://x", { headers: { Authorization: "Bearer secret" } }))).toBe("secret");
    expect(extractBearerToken(new Request("http://x"))).toBeNull();
    expect(extractBearerToken(new Request("http://x", { headers: { Authorization: "Basic x" } }))).toBeNull();
  });
});

describe("GET /v1/* auth gate", () => {
  beforeAll(() => {
    // vitest-pool-workers provides env from wrangler; inject test secret
    (env as Env).SYNC_TOKEN = "test-sync-token";
  });

  it("allows /health without auth", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("http://example.com/health"), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
  });

  it("rejects /v1/manifest without token", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("http://example.com/v1/manifest"), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("rejects /v1/manifest with wrong token", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request("http://example.com/v1/manifest", {
        headers: { Authorization: "Bearer wrong" },
      }),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("allows /v1/manifest with valid token (404 until Phase 3)", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request("http://example.com/v1/manifest", {
        headers: { Authorization: "Bearer test-sync-token" },
      }),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("not_found");
  });
});
