import { test, expect } from "vitest";
import {
  bytesToBase64,
  base64ToBytes,
  buildTeamVaultFiles,
  parseTeamVaultFile,
  parseTeamVaultBlobFiles,
  type TeamVaultSlices,
} from "./teamVaultSyncCore.ts";

test("base64 round-trips arbitrary bytes", () => {
  const bytes = [0, 1, 2, 127, 128, 200, 255];
  expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
});

test("base64 round-trips empty input", () => {
  expect(bytesToBase64([])).toBe("");
  expect(base64ToBytes("")).toEqual([]);
});

test("base64 round-trips across the 8192 chunk boundary", () => {
  const bytes = Array.from({ length: 20000 }, (_, i) => i % 256);
  expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
});

test("parseTeamVaultFile tolerates undefined and malformed json", () => {
  expect(parseTeamVaultFile(undefined)).toEqual([]);
  expect(parseTeamVaultFile("not json")).toEqual([]);
  expect(parseTeamVaultFile('[{"id":"a"}]')).toEqual([{ id: "a" }]);
});

test("buildTeamVaultFiles maps every slice to its exact file key", () => {
  const slices: TeamVaultSlices = {
    connections: [{ id: "c" }],
    identities: [{ id: "i" }],
    keys: [{ id: "k" }],
    folders: [{ id: "f" }],
    snippets: [{ id: "s" }],
    snippetFolders: [{ id: "sf" }],
    portForwardingRules: [{ id: "p" }],
  };
  const files = buildTeamVaultFiles(slices);
  expect(Object.keys(files).sort()).toEqual([
    "connections.json", "folders.json", "identities.json",
    "port_forwarding_rules.json", "snippet_folders.json", "snippets.json", "ssh_keys.json",
  ]);
  expect(files["ssh_keys.json"]).toBe('[{"id":"k"}]');
  expect(files["port_forwarding_rules.json"]).toBe('[{"id":"p"}]');
});

test("build → parse is a round trip", () => {
  const slices: TeamVaultSlices = {
    connections: [{ id: "c1" }, { id: "c2" }],
    identities: [{ id: "i1" }],
    keys: [],
    folders: [{ id: "f1" }],
    snippets: [],
    snippetFolders: [],
    portForwardingRules: [{ id: "p1" }],
  };
  expect(parseTeamVaultBlobFiles(buildTeamVaultFiles(slices))).toEqual(slices);
});

test("parseTeamVaultBlobFiles fills missing keys with empty arrays", () => {
  expect(parseTeamVaultBlobFiles({})).toEqual({
    connections: [], identities: [], keys: [], folders: [],
    snippets: [], snippetFolders: [], portForwardingRules: [],
  });
});
