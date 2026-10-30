// @vitest-environment jsdom
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import type { PluginAPI, PluginManifest } from "@/plugins/api";

const h = vi.hoisted(() => ({ invoke: vi.fn(), stateImports: [] as Array<{ files: Record<string, string> }> }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));

import { loadPlugin, unloadPlugin } from "@/plugins/runtime";
import { ENTITY_FILES, onRemotePayloadMerged } from "@/services/sync";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";

const PLUGIN_ID = "gist-sync-import-test";
const KEY = "ab".repeat(32);

const host = (id: string, name: string, at: string) => ({
  id, name, tags: [], updated_at: at, clocks: { name: at },
});

/** Blobs are plain names here: `backup_decrypt` maps each to its payload, or fails like a wrong key. */
const payloads: Record<string, unknown[] | "wrong-key"> = {};

function blob(name: string): string {
  return btoa(name);
}

function headed(name: string, deviceId?: string): string {
  const json = new TextEncoder().encode(JSON.stringify(deviceId === undefined ? { version: 1 } : { version: 1, device_id: deviceId }));
  const bytes = [...new Uint8Array(new Uint32Array([json.length]).buffer), ...json, ...new TextEncoder().encode(name)];
  return btoa(String.fromCharCode(...bytes));
}

function nameOf(bytes: number[]): string {
  const len = bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24);
  return String.fromCharCode(...bytes.slice(4 + len));
}

function payloadFiles(connections: unknown[]): Record<string, string> {
  return { ...Object.fromEntries(ENTITY_FILES.map((f) => [f, "[]"])), "connections.json": JSON.stringify(connections) };
}

function importedHosts(): Array<{ id: string; name: string }> {
  expect(h.stateImports).toHaveLength(1);
  return JSON.parse(h.stateImports[0].files["connections.json"]);
}

let api: PluginAPI;

beforeEach(() => {
  h.stateImports.length = 0;
  for (const k of Object.keys(payloads)) delete payloads[k];
  useSyncPrefsStore.setState({ syncTypes: {}, excludedIds: [] });
  h.invoke.mockReset();
  h.invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
    switch (cmd) {
      case "state_export_raw":
        return { files: payloadFiles([host("local", "Local", "2030-01-01T00:00:00.000Z")]), secrets: {}, secret_clocks: {} };
      case "backup_decrypt": {
        const raw = args?.blob as number[];
        const name = raw[1] === 0 && raw[2] === 0 ? nameOf(raw) : String.fromCharCode(...raw);
        const p = payloads[name];
        if (p === "wrong-key") throw "Decryption failed — wrong key or corrupted blob";
        return { files: payloadFiles(p ?? []), secrets: {}, secret_clocks: {} };
      }
      case "state_import":
        h.stateImports.push(args as { files: Record<string, string> });
        return undefined;
      default:
        return cmd.endsWith("_list") ? [] : null;
    }
  });

  const manifest: PluginManifest = { id: PLUGIN_ID, name: "Gist Sync", version: "1.0.0", permissions: ["sync:write"] };
  loadPlugin(manifest, (a) => { api = a; }, true);
});

afterEach(() => unloadPlugin(PLUGIN_ID));

test("an unreadable device blob is skipped and the readable ones still merge", async () => {
  payloads.other = "wrong-key";
  payloads.good = [host("remote", "Remote", "2030-01-02T00:00:00.000Z")];
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

  const { unreadable } = await api.sync.importStates(KEY, [blob("other"), blob("good")]);

  expect(importedHosts().map((c) => c.id).sort()).toEqual(["local", "remote"]);
  expect(unreadable).toEqual([0]);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining("skipped 1 of 2"));
});

test("an object held back from sync on this device is not overwritten by a gist blob", async () => {
  useSyncPrefsStore.setState({ excludedIds: ["local"] });
  payloads.good = [host("local", "Changed elsewhere", "2030-01-02T00:00:00.000Z")];

  await api.sync.importStates(KEY, [blob("good")]);

  expect(importedHosts()).toEqual([expect.objectContaining({ id: "local", name: "Local" })]);
});

test("no readable blob rejects, so a wrong passphrase is reported, and nothing is written", async () => {
  payloads.other = "wrong-key";
  vi.spyOn(console, "warn").mockImplementation(() => {});

  await expect(api.sync.importStates(KEY, [blob("other")])).rejects.toThrow();

  expect(h.stateImports).toHaveLength(0);
});

test("plugin_import_fires_the_merge_hook_per_device", async () => {
  payloads.b = [host("rb", "B", "2030-01-02T00:00:00.000Z")];
  payloads.c = [host("rc", "C", "2030-01-03T00:00:00.000Z")];
  payloads.anon = [host("ra", "A", "2030-01-04T00:00:00.000Z")];
  const seen: Array<[string, unknown]> = [];
  const off = onRemotePayloadMerged((id, p) => seen.push([id, p]));

  await api.sync.importStates(KEY, [headed("b", "dev-b"), headed("c", "dev-c"), headed("anon")]);

  expect(seen.map(([id]) => id)).toEqual(["dev-b", "dev-c"]);
  expect(JSON.parse((seen[0][1] as { files: Record<string, string> }).files["connections.json"])[0].id).toBe("rb");
  expect(importedHosts().map((c) => c.id).sort()).toEqual(["local", "ra", "rb", "rc"]);

  h.stateImports.length = 0;
  seen.length = 0;
  const failing = h.invoke.getMockImplementation()!;
  h.invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "state_import") throw new Error("disk full");
    return failing(cmd, args);
  });
  await expect(api.sync.importStates(KEY, [headed("b", "dev-b")])).rejects.toThrow("disk full");
  expect(seen).toEqual([]);
  off();
});
