import test from "node:test";
import assert from "node:assert/strict";
import { existingConnectionsForVault } from "../src/services/import-export/context.ts";

test("scopes import duplicate candidates to the target vault", () => {
  const connections = [
    { id: "personal-1", host: "example.com", port: 22, username: "root", vault_id: "personal" },
    { id: "team-1", host: "example.com", port: 22, username: "root", vault_id: "team-a" },
    { id: "legacy-personal", host: "legacy.example.com", port: 22, username: "root" },
  ];

  assert.deepEqual(
    existingConnectionsForVault(connections, "team-b").map((c) => c.id),
    [],
  );
  assert.deepEqual(
    existingConnectionsForVault(connections, "team-a").map((c) => c.id),
    ["team-1"],
  );
  assert.deepEqual(
    existingConnectionsForVault(connections, "personal").map((c) => c.id),
    ["personal-1", "legacy-personal"],
  );
});
