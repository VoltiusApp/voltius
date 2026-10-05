// @vitest-environment jsdom
import { test, expect } from "vitest";
import { existingConnectionsForVault } from "../src/services/import-export/context.ts";

test("scopes import duplicate candidates to the target vault", () => {
  const connections = [
    { id: "personal-1", host: "example.com", port: 22, username: "root", vault_id: "personal" },
    { id: "team-1", host: "example.com", port: 22, username: "root", vault_id: "team-a" },
    { id: "legacy-personal", host: "legacy.example.com", port: 22, username: "root" },
  ];

  expect(existingConnectionsForVault(connections, "team-b").map((c) => c.id)).toEqual([]);
  expect(existingConnectionsForVault(connections, "team-a").map((c) => c.id)).toEqual(["team-1"]);
  expect(existingConnectionsForVault(connections, "personal").map((c) => c.id)).toEqual(["personal-1", "legacy-personal"]);
});
