// @vitest-environment jsdom
import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ invoke: vi.fn(), files: {} as Record<string, string> }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));

import { ENTITY_FILES, mergeBlobPayload, mergeRemotePayload } from "./sync";

const AT = "2026-01-01T00:00:00.000Z";
const entity = (id: string) => ({ id, updated_at: AT, clocks: { name: AT } });
const payload = (connections: unknown) => ({ files: { "connections.json": JSON.stringify(connections) }, secrets: {} });
const tick = () => new Promise((r) => setTimeout(r, 5));

beforeEach(() => {
  h.files = Object.fromEntries(ENTITY_FILES.map((f) => [f, "[]"]));
  h.invoke.mockReset().mockImplementation(async (cmd: string, args?: { files: Record<string, string> }) => {
    if (cmd === "state_export_raw") {
      const snapshot = { files: { ...h.files }, secrets: {}, secret_clocks: {} };
      await tick();
      return snapshot;
    }
    if (cmd === "state_import") {
      await tick();
      h.files = { ...args!.files };
    }
    return null;
  });
});

test("overlapping merges both keep their entities", async () => {
  await Promise.all([
    mergeRemotePayload("lan-peer", payload([entity("from-lan")])),
    mergeRemotePayload("cloud-device", payload([entity("from-cloud")])),
  ]);
  const ids = JSON.parse(h.files["connections.json"]).map((e: { id: string }) => e.id).sort();
  expect(ids).toEqual(["from-cloud", "from-lan"]);
});

test("a non-array remote file changes nothing", () => {
  const base = payload([entity("a")]);
  const { payload: merged, changed } = mergeBlobPayload(base, payload(null));
  expect(changed).toBe(false);
  expect(JSON.parse(merged.files["connections.json"])).toEqual([entity("a")]);
});

test("a non-array local file reads as empty and takes the remote entities", () => {
  const { payload: merged, changed } = mergeBlobPayload(payload({ not: "a list" }), payload([entity("r")]));
  expect(changed).toBe(true);
  expect(JSON.parse(merged.files["connections.json"])).toEqual([entity("r")]);
});
