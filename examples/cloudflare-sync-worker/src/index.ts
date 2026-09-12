import { requireSyncToken, jsonError } from "./auth";
import { handleOptions, withCors } from "./cors";
import {
  deleteDeviceBlob,
  getDeviceBlob,
  isValidDeviceId,
  parseDevicePutBody,
  putDeviceBlob,
} from "./devices";
import { json } from "./http";
import { isManifest, readManifest, writeManifest } from "./manifest";

const DEVICE_PATH = /^\/v1\/devices\/([^/]+)$/;

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return handleOptions();
    }
    return withCors(await handleRequest(request, env));
  },
} satisfies ExportedHandler<Env>;

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/health") {
    return json({ ok: true, version: 1 });
  }

  if (url.pathname === "/v1" || url.pathname.startsWith("/v1/")) {
    const denied = requireSyncToken(request, env);
    if (denied) return denied;

    try {
      if (url.pathname === "/v1/manifest" && request.method === "GET") {
        const manifest = await readManifest(env.VAULT_BUCKET);
        if (!manifest) {
          return jsonError(404, "not_found", "manifest.json does not exist yet");
        }
        return json(manifest);
      }

      if (url.pathname === "/v1/manifest" && request.method === "PUT") {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return jsonError(400, "bad_request", "Request body must be JSON");
        }
        if (!isManifest(body)) {
          return jsonError(400, "bad_request", "Invalid manifest schema");
        }
        await writeManifest(env.VAULT_BUCKET, body);
        return json(body);
      }

      const deviceMatch = DEVICE_PATH.exec(url.pathname);
      if (deviceMatch) {
        const deviceId = decodeURIComponent(deviceMatch[1]);
        if (!isValidDeviceId(deviceId)) {
          return jsonError(400, "bad_request", "Invalid device id");
        }

        if (request.method === "GET") {
          const blob = await getDeviceBlob(env.VAULT_BUCKET, deviceId);
          if (!blob) {
            return jsonError(404, "not_found", `Device blob not found: ${deviceId}`);
          }
          return json({ content: blob.content, etag: blob.etag });
        }

        if (request.method === "PUT") {
          let body: unknown;
          try {
            body = await request.json();
          } catch {
            return jsonError(400, "bad_request", "Request body must be JSON");
          }
          const parsed = parseDevicePutBody(body);
          if (!parsed) {
            return jsonError(400, "bad_request", "Body must be { content, label, pushedAt }");
          }
          try {
            const result = await putDeviceBlob(env.VAULT_BUCKET, deviceId, parsed);
            return json({
              content: parsed.content,
              etag: result.etag,
              manifest: result.manifest,
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (message.includes("manifest.json missing")) {
              return jsonError(409, "conflict", message);
            }
            throw err;
          }
        }

        if (request.method === "DELETE") {
          const manifest = await deleteDeviceBlob(env.VAULT_BUCKET, deviceId);
          return json({ ok: true, manifest });
        }
      }

      return json(
        { error: "not_found", message: `No route for ${request.method} ${url.pathname}` },
        404,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return jsonError(500, "internal", message);
    }
  }

  return json(
    { error: "not_found", message: `No route for ${request.method} ${url.pathname}` },
    404,
  );
}
