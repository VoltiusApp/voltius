// @vitest-environment jsdom
import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ invoke: vi.fn(), appFetch: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch }));

import { push, haltSync, resumeSync, importMergedPayload, writeFilteredSettings } from "./sync";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { setVaultKey } from "@/services/vault";

function jwt(expOffsetSec: number): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o));
  return `${b64({ alg: "none" })}.${b64({ exp: Math.floor(Date.now() / 1000) + expOffsetSec })}.sig`;
}

beforeEach(() => {
  h.appFetch.mockReset();
  h.invoke.mockReset();
  h.invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "keychain_get") {
      if (args?.key === "server_url") return "https://sync.example.com";
      if (args?.key === "jwt") return jwt(3600);
      if (args?.key === "account_id") return "account-1";
      return null;
    }
    if (cmd === "backup_export") return [];
    return null;
  });
  h.appFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  useSyncPrefsStore.setState({ syncTypes: {}, excludedIds: [], syncSettingDomains: {}, settingSyncOverrides: {} });
  localStorage.setItem("voltius.device_id", "local-device");
  setVaultKey([1, 2, 3]);
  resumeSync();
});

const invoked = (cmd: string) => h.invoke.mock.calls.some(([c]) => c === cmd);

test("push hands its abort signal to the upload", async () => {
  const { signal } = new AbortController();

  await push({ signal });

  const upload = h.appFetch.mock.calls.find(([, init]) => init?.method === "PUT");
  expect(upload?.[1].signal).toBe(signal);
});

test("push without options uploads as before", async () => {
  await push();

  expect(h.appFetch.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true);
});

test("a halted sync writes nothing local and uploads nothing", async () => {
  haltSync();

  await expect(importMergedPayload({ files: {}, secrets: {} })).rejects.toThrow();
  await expect(writeFilteredSettings()).rejects.toThrow();
  await expect(push()).rejects.toThrow();

  expect(invoked("state_import")).toBe(false);
  expect(invoked("settings_save")).toBe(false);
  expect(h.appFetch.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
});

test("a resumed sync writes again", async () => {
  haltSync();
  resumeSync();

  await importMergedPayload({ files: {}, secrets: {} });

  expect(invoked("state_import")).toBe(true);
});
