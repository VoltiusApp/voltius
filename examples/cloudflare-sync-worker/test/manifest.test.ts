import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import worker from "../src/index";
import { MANIFEST_KEY, isManifest } from "../src/manifest";

const TOKEN = "test-sync-token";

function authHeaders(): HeadersInit {
  return { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
}

const sample = {
  schema: 1 as const,
  salt: "0123456789abcdef0123456789abcdef",
  devices: [{ id: "dev-1", label: "laptop", pushedAt: "2026-09-12T00:00:00.000Z" }],
};

describe("manifest helpers", () => {
  it("accepts valid manifests", () => {
    expect(isManifest(sample)).toBe(true);
    expect(isManifest({ ...sample, salt: "nope" })).toBe(false);
  });
});

describe("GET/PUT /v1/manifest", () => {
  beforeAll(() => {
    (env as Env).SYNC_TOKEN = TOKEN;
  });

  beforeEach(async () => {
    // Clear R2 between tests
    const listed = await env.VAULT_BUCKET.list();
    await Promise.all(listed.objects.map((o) => env.VAULT_BUCKET.delete(o.key)));
  });

  it("returns 404 when missing", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request("http://example.com/v1/manifest", { headers: authHeaders() }),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
  });

  it("puts and gets a manifest", async () => {
    const ctxPut = createExecutionContext();
    const putRes = await worker.fetch(
      new Request("http://example.com/v1/manifest", {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify(sample),
      }),
      env,
      ctxPut,
    );
    await waitOnExecutionContext(ctxPut);
    expect(putRes.status).toBe(200);
    expect(await putRes.json()).toEqual(sample);

    const stored = await env.VAULT_BUCKET.get(MANIFEST_KEY);
    expect(stored).not.toBeNull();

    const ctxGet = createExecutionContext();
    const getRes = await worker.fetch(
      new Request("http://example.com/v1/manifest", { headers: authHeaders() }),
      env,
      ctxGet,
    );
    await waitOnExecutionContext(ctxGet);
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toEqual(sample);
  });

  it("rejects invalid manifest bodies", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request("http://example.com/v1/manifest", {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ schema: 1, salt: "short", devices: [] }),
      }),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(400);
  });
});
