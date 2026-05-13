import test from "node:test";
import assert from "node:assert/strict";
import { buildTeamVaultTransferPlan } from "../src/services/teamVaultPermissions.ts";

const canAll = () => true;

test("host transfer includes primary and jump-host identities and keys once", () => {
  const plan = buildTeamVaultTransferPlan({
    operation: "copy",
    targetVaultId: "team-b",
    selected: { connectionIds: ["host-1"] },
    can: canAll,
    connections: [{
      id: "host-1",
      name: "Prod",
      host: "prod.example.com",
      port: 22,
      username: "deploy",
      auth_type: "key",
      tags: [],
      created_at: "now",
      updated_at: "now",
      last_used_at: null,
      clocks: {},
      vault_id: "team-a",
      identity_id: "identity-1",
      jump_hosts: [{ id: "jump-1", connection_id: "host-1", host: "bastion", port: 22, username: "jump", identity_id: "identity-2" }],
    }],
    identities: [
      { id: "identity-1", username: "deploy", tags: [], created_at: "now", updated_at: "now", clocks: {}, vault_id: "team-a", key_id: "key-1" },
      { id: "identity-2", username: "jump", tags: [], created_at: "now", updated_at: "now", clocks: {}, vault_id: "team-a", key_id: "key-1" },
    ],
    keys: [{ id: "key-1", name: "Shared", tags: [], created_at: "now", updated_at: "now", clocks: {}, vault_id: "team-a" }],
    folders: [],
    snippets: [],
    snippetFolders: [],
  });

  assert.deepEqual([...plan.connections.keys()], ["host-1"]);
  assert.deepEqual([...plan.identities.keys()].sort(), ["identity-1", "identity-2"]);
  assert.deepEqual([...plan.keys.keys()], ["key-1"]);
  assert.equal(plan.allowed, true);
  assert.deepEqual(plan.destinationPermissions.sort(), ["EDIT_CONNECTIONS", "EDIT_IDENTITIES", "EDIT_KEYS"]);
  assert.deepEqual(plan.sourcePermissions.sort(), ["COPY_SECRETS", "VIEW_SECRETS"]);
});

test("folder transfer includes nested folders and descendant objects", () => {
  const plan = buildTeamVaultTransferPlan({
    operation: "move",
    targetVaultId: "team-b",
    selected: { folderIds: ["folder-root"] },
    can: canAll,
    connections: [{
      id: "host-1",
      host: "prod.example.com",
      port: 22,
      username: "deploy",
      auth_type: "password",
      tags: [],
      created_at: "now",
      updated_at: "now",
      last_used_at: null,
      clocks: {},
      vault_id: "team-a",
      folder_id: "folder-child",
    }],
    identities: [],
    keys: [],
    folders: [
      { id: "folder-root", name: "Root", object_type: "connection", created_at: "now", updated_at: "now", clocks: {}, vault_id: "team-a" },
      { id: "folder-child", name: "Child", object_type: "connection", created_at: "now", updated_at: "now", clocks: {}, vault_id: "team-a", parent_folder_id: "folder-root" },
    ],
    snippets: [],
    snippetFolders: [],
  });

  assert.deepEqual([...plan.folders.keys()].sort(), ["folder-child", "folder-root"]);
  assert.deepEqual([...plan.connections.keys()], ["host-1"]);
  assert.equal(plan.allowed, true);
  assert.deepEqual(plan.destinationPermissions.sort(), ["EDIT_CONNECTIONS", "EDIT_FOLDERS"]);
  assert.deepEqual(plan.sourcePermissions.sort(), ["EDIT_CONNECTIONS", "EDIT_FOLDERS"]);
});

test("target is denied when destination lacks required dependency permission", () => {
  const plan = buildTeamVaultTransferPlan({
    operation: "copy",
    targetVaultId: "team-b",
    selected: { identityIds: ["identity-1"] },
    can: (permission) => permission !== "EDIT_KEYS",
    connections: [],
    identities: [{ id: "identity-1", username: "deploy", tags: [], created_at: "now", updated_at: "now", clocks: {}, vault_id: "team-a", key_id: "key-1" }],
    keys: [{ id: "key-1", name: "Shared", tags: [], created_at: "now", updated_at: "now", clocks: {}, vault_id: "team-a" }],
    folders: [],
    snippets: [],
    snippetFolders: [],
  });

  assert.equal(plan.allowed, false);
  assert.deepEqual(plan.deniedReasons, ["Missing EDIT_KEYS on team-b"]);
});
