import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import worker from "../src/index";
import { deviceObjectKey } from "../src/devices";

const TOKEN = "test-sync-token";
const salt = "0123456789abcdef0123456789abcdef";

function authHeaders(): HeadersInit {
  return { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
}

async function putManifest(devices: Array<{ id: string; label: string; pushedAt: string }> = []) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request("http://example.com/v1/manifest", {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ schema: 1, salt, devices }),
    }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  expect(res.status).toBe(200);
}

describe("device blob routes", () => {
  beforeAll(() => {
    (env as Env).SYNC_TOKEN = TOKEN;
  });

  beforeEach(async () => {
    const listed = await env.VAULT_BUCKET.list();
    await Promise.all(listed.objects.map((o) => env.VAULT_BUCKET.delete(o.key)));
  });

  it("rejects device put without manifest", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request("http://example.com/v1/devices/dev-1", {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({
          content: "cipherblob",
          label: "laptop",
          pushedAt: "2026-09-12T00:00:00.000Z",
        }),
      }),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(409);
  });

  it("puts, gets, and deletes a device blob and upserts manifest", async () => {
    await putManifest();

    const ctxPut = createExecutionContext();
    const putRes = await worker.fetch(
      new Request("http://example.com/v1/devices/dev-1", {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({
          content: "opaque-b64",
          label: "laptop",
          pushedAt: "2026-09-12T01:00:00.000Z",
        }),
      }),
      env,
      ctxPut,
    );
    await waitOnExecutionContext(ctxPut);
    expect(putRes.status).toBe(200);
    const putBody = await putRes.json() as {
      content: string;
      manifest: { devices: Array<{ id: string; pushedAt: string }> };
    };
    expect(putBody.content).toBe("opaque-b64");
    expect(putBody.manifest.devices).toEqual([
      { id: "dev-1", label: "laptop", pushedAt: "2026-09-12T01:00:00.000Z" },
    ]);
    expect(await env.VAULT_BUCKET.get(deviceObjectKey("dev-1"))).not.toBeNull();

    const ctxGet = createExecutionContext();
    const getRes = await worker.fetch(
      new Request("http://example.com/v1/devices/dev-1", { headers: authHeaders() }),
      env,
      ctxGet,
    );
    await waitOnExecutionContext(ctxGet);
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toMatchObject({ content: "opaque-b64" });

    const ctxDel = createExecutionContext();
    const delRes = await worker.fetch(
      new Request("http://example.com/v1/devices/dev-1", {
        method: "DELETE",
        headers: authHeaders(),
      }),
      env,
      ctxDel,
    );
    await waitOnExecutionContext(ctxDel);
    expect(delRes.status).toBe(200);
    const delBody = await delRes.json() as { manifest: { devices: unknown[] } };
    expect(delBody.manifest.devices).toEqual([]);
    expect(await env.VAULT_BUCKET.get(deviceObjectKey("dev-1"))).toBeNull();
  });

  it("device PUT returns 412 when If-Match does not match the manifest ETag", async () => {
    await putManifest();
    const ctxGet = createExecutionContext();
    const getRes = await worker.fetch(
      new Request("http://example.com/v1/manifest", { headers: authHeaders() }),
      env,
      ctxGet,
    );
    await waitOnExecutionContext(ctxGet);
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get("ETag")).toBeTruthy();

    const ctxStale = createExecutionContext();
    const stale = await worker.fetch(
      new Request("http://example.com/v1/devices/dev-1", {
        method: "PUT",
        headers: { ...authHeaders() as Record<string, string>, "If-Match": '"stale-manifest"' },
        body: JSON.stringify({
          content: "opaque-b64",
          label: "laptop",
          pushedAt: "2026-09-12T01:00:00.000Z",
        }),
      }),
      env,
      ctxStale,
    );
    await waitOnExecutionContext(ctxStale);
    expect(stale.status).toBe(412);

    const ctxOk = createExecutionContext();
    const ok = await worker.fetch(
      new Request("http://example.com/v1/devices/dev-1", {
        method: "PUT",
        headers: { ...authHeaders() as Record<string, string>, "If-Match": getRes.headers.get("ETag")! },
        body: JSON.stringify({
          content: "opaque-b64",
          label: "laptop",
          pushedAt: "2026-09-12T01:00:00.000Z",
        }),
      }),
      env,
      ctxOk,
    );
    await waitOnExecutionContext(ctxOk);
    expect(ok.status).toBe(200);
  });

  it("GET device keeps returning an etag", async () => {
    await putManifest();
    const ctxPut = createExecutionContext();
    await worker.fetch(
      new Request("http://example.com/v1/devices/dev-1", {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({
          content: "opaque-b64",
          label: "laptop",
          pushedAt: "2026-09-12T01:00:00.000Z",
        }),
      }),
      env,
      ctxPut,
    );
    await waitOnExecutionContext(ctxPut);

    const ctxGet = createExecutionContext();
    const getRes = await worker.fetch(
      new Request("http://example.com/v1/devices/dev-1", { headers: authHeaders() }),
      env,
      ctxGet,
    );
    await waitOnExecutionContext(ctxGet);
    expect(getRes.status).toBe(200);
    const body = await getRes.json() as { etag: string };
    expect(body.etag).toBeTruthy();
    expect(getRes.headers.get("ETag")).toBeTruthy();
  });

  it("rejects path-like device ids", async () => {
    await putManifest();
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request("http://example.com/v1/devices/../etc", {
        method: "GET",
        headers: authHeaders(),
      }),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    // Either 400 (invalid id) or 404 (routing) is acceptable; must not read arbitrary keys
    expect([400, 404]).toContain(res.status);
  });
});
