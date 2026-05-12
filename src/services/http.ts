import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

export type AppFetchInit = RequestInit & { connectTimeout?: number };

export async function appFetch(input: string | URL, init?: AppFetchInit): Promise<Response> {
  return tauriFetch(input, init ? { ...init } : undefined);
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.message === "Request cancelled");
}
