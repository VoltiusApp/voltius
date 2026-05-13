import { invoke } from "@tauri-apps/api/core";

export type AppFetchInit = RequestInit & { connectTimeout?: number };

interface NativeHttpResponse {
  status: number;
  status_text: string;
  headers: Array<{ name: string; value: string }>;
  body: string;
}

const NULL_BODY_STATUSES = new Set([204, 205, 304]);

export async function appFetch(input: string | URL, init?: AppFetchInit): Promise<Response> {
  const request = new Request(input, init);
  const body = await request.text();
  const response = await invoke<NativeHttpResponse>("http_request", {
    url: request.url,
    method: request.method,
    headers: Array.from(request.headers.entries()).map(([name, value]) => ({ name, value })),
    body: body.length > 0 ? body : null,
    connectTimeoutMs: init?.connectTimeout ?? null,
  });

  return new Response(NULL_BODY_STATUSES.has(response.status) ? null : response.body, {
    status: response.status,
    statusText: response.status_text,
    headers: response.headers.map(({ name, value }) => [name, value]),
  });
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.message === "Request cancelled");
}
