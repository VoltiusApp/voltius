import { findSavedHostMatch } from "./savedHostMatch.ts";
import type { Connection } from "../types/index.ts";

function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`FAIL ${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    throw new Error(msg);
  }
  console.log(`PASS ${msg}`);
}

function conn(partial: Partial<Connection>): Connection {
  return {
    id: partial.id ?? crypto.randomUUID(),
    name: partial.name ?? "",
    host: partial.host ?? "",
    port: partial.port ?? 22,
    username: partial.username ?? "",
    auth_type: partial.auth_type ?? "password",
    tags: [],
    vault_id: partial.vault_id,
    connection_type: partial.connection_type,
    created_at: "",
    updated_at: "",
    last_used_at: null,
    clocks: {},
  } as Connection;
}

const target = { host: "h1", port: 22, username: "alice", vaultId: "personal" };

const exact = conn({ id: "A", host: "h1", port: 22, username: "alice", vault_id: "personal" });
assertEqual(findSavedHostMatch([exact], target)?.id, "A", "exact match returns host");

const noVault = conn({ id: "B", host: "h1", port: 22, username: "alice" });
assertEqual(findSavedHostMatch([noVault], target)?.id, "B", "undefined vault_id treated as personal");

const otherPort = conn({ id: "C", host: "h1", port: 2222, username: "alice", vault_id: "personal" });
assertEqual(findSavedHostMatch([otherPort], target), undefined, "different port no match");

const otherUser = conn({ id: "D", host: "h1", port: 22, username: "bob", vault_id: "personal" });
assertEqual(findSavedHostMatch([otherUser], target), undefined, "different username no match");

const serial = conn({ id: "E", host: "h1", port: 22, username: "alice", vault_id: "personal", connection_type: "serial" });
assertEqual(findSavedHostMatch([serial], target), undefined, "serial host excluded");

const teamVault = conn({ id: "F", host: "h1", port: 22, username: "alice", vault_id: "team-xyz" });
assertEqual(findSavedHostMatch([teamVault], target), undefined, "non-personal vault no match");

assertEqual(findSavedHostMatch([], target), undefined, "empty list returns undefined");

assertEqual(findSavedHostMatch([exact, noVault], target)?.id, "A", "first match wins");

console.log("All savedHostMatch tests passed.");
