import { requireSyncToken } from "./auth";
import { json } from "./http";

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, version: 1 });
    }

    // Phase 2: gate all /v1/* behind SYNC_TOKEN. Concrete routes arrive in later phases.
    if (url.pathname === "/v1" || url.pathname.startsWith("/v1/")) {
      const denied = requireSyncToken(request, env);
      if (denied) return denied;
      return json(
        { error: "not_found", message: `No route for ${request.method} ${url.pathname}` },
        404,
      );
    }

    return json(
      { error: "not_found", message: `No route for ${request.method} ${url.pathname}` },
      404,
    );
  },
} satisfies ExportedHandler<Env>;
