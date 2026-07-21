import { test, expect } from "vitest";
import {
  buildTeamVaultTransferPlan,
  type BuildTransferPlanInput,
} from "./teamVaultPermissions.ts";
import type { Connection, Identity, SshKey, Folder, Snippet } from "@/types";

const conn = (o: Partial<Connection>): Connection => o as Connection;
const idn = (o: Partial<Identity>): Identity => o as Identity;
const key = (o: Partial<SshKey>): SshKey => o as SshKey;
const fld = (o: Partial<Folder>): Folder => o as Folder;
const snp = (o: Partial<Snippet>): Snippet => o as Snippet;

function base(over: Partial<BuildTransferPlanInput> = {}): BuildTransferPlanInput {
  return {
    operation: "move",
    targetVaultId: "team-a",
    selected: {},
    can: () => true,
    connections: [], identities: [], keys: [], folders: [], snippets: [], snippetFolders: [],
    ...over,
  };
}

test("empty selection → allowed, nothing collected, no permissions", () => {
  const plan = buildTeamVaultTransferPlan(base());
  expect(plan.allowed).toBe(true);
  expect(plan.connections.size).toBe(0);
  expect(plan.destinationPermissions).toEqual([]);
  expect(plan.sourcePermissions).toEqual([]);
});

test("move a connection requires EDIT_CONNECTIONS on both source and destination", () => {
  const plan = buildTeamVaultTransferPlan(base({
    selected: { connectionIds: ["c1"] },
    connections: [conn({ id: "c1", vault_id: "team-b" })],
  }));
  expect(plan.connections.has("c1")).toBe(true);
  expect(plan.destinationPermissions).toContain("EDIT_CONNECTIONS");
  expect(plan.sourcePermissions).toContain("EDIT_CONNECTIONS");
});

test("copy a connection with a secret adds VIEW_SECRETS+COPY_SECRETS on source, not on destination", () => {
  const plan = buildTeamVaultTransferPlan(base({
    operation: "copy",
    selected: { connectionIds: ["c1"] },
    connections: [conn({ id: "c1", vault_id: "team-b" })],
  }));
  // copy does not require EDIT on source
  expect(plan.sourcePermissions).toEqual(expect.arrayContaining(["VIEW_SECRETS", "COPY_SECRETS"]));
  expect(plan.sourcePermissions).not.toContain("EDIT_CONNECTIONS");
  expect(plan.destinationPermissions).toContain("EDIT_CONNECTIONS");
});

test("connection pulls in its primary identity and that identity's key", () => {
  const plan = buildTeamVaultTransferPlan(base({
    selected: { connectionIds: ["c1"] },
    connections: [conn({ id: "c1", vault_id: "team-b", identity_id: "i1" })],
    identities: [idn({ id: "i1", key_id: "k1" })],
    keys: [key({ id: "k1" })],
  }));
  expect(plan.identities.has("i1")).toBe(true);
  expect(plan.keys.has("k1")).toBe(true);
  expect(plan.destinationPermissions).toEqual(expect.arrayContaining(["EDIT_IDENTITIES", "EDIT_KEYS"]));
});

test("selecting a folder pulls in child folders and folder-scoped items", () => {
  const plan = buildTeamVaultTransferPlan(base({
    selected: { folderIds: ["f1"] },
    folders: [fld({ id: "f1" }), fld({ id: "f2", parent_folder_id: "f1" })],
    connections: [conn({ id: "c1", vault_id: "team-b", folder_id: "f2" })],
  }));
  expect(plan.folders.has("f1")).toBe(true);
  expect(plan.folders.has("f2")).toBe(true);
  expect(plan.connections.has("c1")).toBe(true);
  expect(plan.destinationPermissions).toContain("EDIT_FOLDERS");
});

test("snippet folder pulls in its snippets and requires EDIT_SNIPPETS", () => {
  const plan = buildTeamVaultTransferPlan(base({
    selected: { snippetFolderIds: ["sf1"] },
    snippetFolders: [fld({ id: "sf1" })],
    snippets: [snp({ id: "s1", folder_id: "sf1" })],
  }));
  expect(plan.snippets.has("s1")).toBe(true);
  expect(plan.destinationPermissions).toContain("EDIT_SNIPPETS");
});

test("deniedReasons populated and allowed=false when can() rejects a needed permission", () => {
  const plan = buildTeamVaultTransferPlan(base({
    selected: { connectionIds: ["c1"] },
    connections: [conn({ id: "c1", vault_id: "team-b" })],
    can: (perm) => perm !== "EDIT_CONNECTIONS",
  }));
  expect(plan.allowed).toBe(false);
  expect(plan.deniedReasons.length).toBeGreaterThan(0);
});

test("destination permissions are returned in sorted (not insertion) order", () => {
  const plan = buildTeamVaultTransferPlan(base({
    selected: { identityIds: ["i1"], folderIds: ["fo1"] },
    identities: [idn({ id: "i1" })],
    folders: [fld({ id: "fo1" })],
  }));
  // EDIT_IDENTITIES is inserted before EDIT_FOLDERS, but output must be alphabetical.
  expect(plan.destinationPermissions).toEqual(["EDIT_FOLDERS", "EDIT_IDENTITIES"]);
});
