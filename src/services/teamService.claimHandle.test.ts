import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  appFetch: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/stores/subscriptionStore", () => ({
  useSubscriptionStore: { getState: () => ({ load: vi.fn(async () => undefined) }) },
}));

import { claimHandle, HandleClaimError } from "./teamService";

function jwt(): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "HS256" })}.${b64({ exp: Math.floor(Date.now() / 1000) + 3600, sub: "u1" })}.sig`;
}

const refuse = (error: string) => ({ ok: false, status: 403, json: async () => ({ error }) });

beforeEach(() => {
  Object.values(h).forEach((m) => m.mockReset());
  const token = jwt();
  h.invoke.mockImplementation(async (_cmd: string, args: { key: string }) =>
    ({ jwt: token, server_url: "https://s" })[args.key] ?? null);
});

test("HANDLE_MANAGED 403 becomes the managed message, not 'verify your email'", async () => {
  h.appFetch.mockResolvedValue(refuse("HANDLE_MANAGED"));
  await expect(claimHandle("x-y")).rejects.toThrow("common.error.handleManaged");
});

test("plain 403 stays a HandleClaimError", async () => {
  h.appFetch.mockResolvedValue(refuse("EMAIL_NOT_VERIFIED"));
  await expect(claimHandle("x-y")).rejects.toBeInstanceOf(HandleClaimError);
});
