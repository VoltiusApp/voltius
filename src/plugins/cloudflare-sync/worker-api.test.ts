import { describe, test, expect, vi } from "vitest";
import {
  getHealth,
  getManifest,
  getManifestWithEtag,
  putManifest,
  getDeviceBlob,
  putDeviceBlob,
  WorkerApiError,
} from "./worker-api";
import type { PluginAPI } from "@/plugins/api";

type Http = PluginAPI["http"];

function mockHttp(handler: (url: string, init?: RequestInit) => Promise<Response>): Http {
  return {
    stream: vi.fn(async (url: string, init?: RequestInit) => handler(url, init)),
  } as unknown as Http;
}

const sampleManifest = {
  schema: 1 as const,
  salt: "0123456789abcdef0123456789abcdef",
  devices: [] as Array<{ id: string; label: string; pushedAt: string }>,
};

describe("worker-api", () => {
  test("getHealth hits /health without auth", async () => {
    const http = mockHttp(async (url) => {
      expect(url).toBe("https://sync.example.com/health");
      return new Response(JSON.stringify({ ok: true, version: 1 }), { status: 200 });
    });
    await expect(getHealth(http, "https://sync.example.com/")).resolves.toEqual({
      ok: true,
      version: 1,
    });
  });

  test("getManifest sends bearer token and parses JSON", async () => {
    const http = mockHttp(async (url, init) => {
      expect(url).toBe("https://sync.example.com/v1/manifest");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer tok");
      return new Response(JSON.stringify(sampleManifest), { status: 200 });
    });
    await expect(getManifest(http, "https://sync.example.com", "tok")).resolves.toEqual(
      sampleManifest,
    );
  });

  test("getManifestWithEtag reads the ETag header", async () => {
    const http = mockHttp(async () =>
      new Response(JSON.stringify(sampleManifest), {
        status: 200,
        headers: { ETag: '"abc123"' },
      }),
    );
    await expect(getManifestWithEtag(http, "https://sync.example.com", "tok")).resolves.toEqual({
      manifest: sampleManifest,
      etag: '"abc123"',
    });
  });

  test("putManifest PUTs body and sends If-Match when provided", async () => {
    const http = mockHttp(async (url, init) => {
      expect(init?.method).toBe("PUT");
      expect(JSON.parse(String(init?.body))).toEqual(sampleManifest);
      expect(new Headers(init?.headers).get("If-Match")).toBe('"abc123"');
      return new Response(JSON.stringify(sampleManifest), { status: 200 });
    });
    await putManifest(http, "https://sync.example.com", "tok", sampleManifest, { ifMatch: '"abc123"' });
  });

  test("getDeviceBlob returns content field", async () => {
    const http = mockHttp(async (url) => {
      expect(url).toContain("/v1/devices/dev-1");
      return new Response(JSON.stringify({ content: "b64", etag: "e1" }), { status: 200 });
    });
    await expect(getDeviceBlob(http, "https://sync.example.com", "tok", "dev-1")).resolves.toBe(
      "b64",
    );
  });

  test("putDeviceBlob sends JSON body and If-Match", async () => {
    const http = mockHttp(async (_url, init) => {
      expect(init?.method).toBe("PUT");
      expect(JSON.parse(String(init?.body))).toEqual({
        content: "b64",
        label: "laptop",
        pushedAt: "2026-09-12T00:00:00.000Z",
      });
      expect(new Headers(init?.headers).get("If-Match")).toBe('"m1"');
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    await putDeviceBlob(http, "https://sync.example.com", "tok", "dev-1", {
      content: "b64",
      label: "laptop",
      pushedAt: "2026-09-12T00:00:00.000Z",
    }, { ifMatch: '"m1"' });
  });

  test("maps 412 If-Match mismatch to WorkerApiError", async () => {
    const http = mockHttp(async () =>
      new Response(JSON.stringify({ error: "precondition_failed", message: "etag mismatch" }), { status: 412 }),
    );
    await expect(putManifest(http, "https://sync.example.com", "tok", sampleManifest, { ifMatch: '"stale"' })).rejects.toMatchObject({
      name: "WorkerApiError",
      status: 412,
    } satisfies Partial<WorkerApiError>);
  });

  test("maps non-OK responses to WorkerApiError", async () => {
    const http = mockHttp(async () =>
      new Response(JSON.stringify({ error: "unauthorized", message: "nope" }), { status: 401 }),
    );
    await expect(getManifest(http, "https://sync.example.com", "bad")).rejects.toMatchObject({
      name: "WorkerApiError",
      status: 401,
    } satisfies Partial<WorkerApiError>);
  });
});
