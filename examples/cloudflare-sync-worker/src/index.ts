import { requireSyncToken, jsonError } from "./auth";
import { json } from "./http";
import { isManifest, readManifest, writeManifest } from "./manifest";

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
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
  },
} satisfies ExportedHandler<Env>;
