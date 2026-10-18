import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ keychain: {} as Record<string, string | null>, openUrl: vi.fn() }));
vi.mock("@/lib/invoke", () => ({
  invoke: vi.fn(async (_cmd: string, { key }: { key: string }) => h.keychain[key] ?? null),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: h.openUrl }));

import { openPortal } from "./billing";

beforeEach(() => {
  h.openUrl.mockReset().mockResolvedValue(undefined);
  h.keychain = {};
});

test("a cloud account hands its token to the account page", async () => {
  h.keychain = { server_url: "https://api.voltius.app", jwt: "cloud.jwt" };
  await openPortal();
  expect(h.openUrl).toHaveBeenCalledWith("https://app.voltius.app/account?token=cloud.jwt");
});

test("a self-hosted account never sends its token to the cloud", async () => {
  h.keychain = { server_url: "https://voltius.example.com", jwt: "self.hosted.jwt" };
  await openPortal();
  expect(h.openUrl).toHaveBeenCalledWith("https://app.voltius.app/account");
});

test("no session opens the page without a token", async () => {
  await openPortal();
  expect(h.openUrl).toHaveBeenCalledWith("https://app.voltius.app/account");
});
