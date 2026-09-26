import { test, expect, vi, beforeEach, afterEach } from "vitest";
import type { PluginAPI, PluginManifest } from "@/plugins/api";

const h = vi.hoisted(() => ({ invoke: vi.fn(), stateImports: [] as Array<{ files: Record<string, string> }> }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));

import { loadPlugin, unloadPlugin } from "@/plugins/runtime";
import { ENTITY_FILES } from "@/services/sync";
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
        const name = String.fromCharCode(...(args?.blob as number[]));
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

  await api.sync.importStates(KEY, [blob("other"), blob("good")]);

  expect(importedHosts().map((c) => c.id).sort()).toEqual(["local", "remote"]);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining("skipped 1 of 2"));
});

test("an object held back from sync on this device is not overwritten by a gist blob", async () => {
  useSyncPrefsStore.setState({ excludedIds: ["local"] });
  payloads.good = [host("local", "Changed elsewhere", "2030-01-02T00:00:00.000Z")];

  await api.sync.importStates(KEY, [blob("good")]);

  expect(importedHosts()).toEqual([expect.objectContaining({ id: "local", name: "Local" })]);
});

test("nothing is written when no blob could be read", async () => {
  payloads.other = "wrong-key";
  vi.spyOn(console, "warn").mockImplementation(() => {});

  await api.sync.importStates(KEY, [blob("other")]);

  expect(h.stateImports).toHaveLength(0);
});
