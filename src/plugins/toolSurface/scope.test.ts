import { describe, it, expect } from "vitest";
import { deriveScope, FILE_TOOLS } from "@voltius/tools";

const api = (sessions: unknown[] = [], connections: unknown[] = []) =>
  ({
    sessions: { list: () => sessions },
    connections: { list: async () => connections },
  }) as never;

describe("deriveScope, reachable from the tool-surface barrel", () => {
  it("resolves a session-addressed tool to the session's connection", async () => {
    const scope = await deriveScope(
      api([{ id: "s1", connectionId: "c1" }], [{ id: "c1" }]),
      "run_command",
      { sessionId: "s1" },
    );
    expect(scope).toBe("c1");
  });

  it("scopes a transfer on its source, never its destination", async () => {
    const scope = await deriveScope(api([], [{ id: "c1" }, { id: "c2" }]), "transfer_file", {
      fromTarget: "c1",
      toTarget: "c2",
    });
    expect(scope).toBe("c1");
  });

  it("returns null for a connection id that matches nothing", async () => {
    expect(await deriveScope(api([], []), "open_session", { connectionId: "forged" })).toBeNull();
  });

  it("carries the file tools that address a target directly", () => {
    expect(FILE_TOOLS.has("transfer_file")).toBe(true);
    expect(FILE_TOOLS.has("run_command")).toBe(false);
  });

  it("scopes a connection mutation to the connection it names", async () => {
    const connApi = {
      sessions: { list: () => [] },
      connections: { list: async () => [{ id: "c1", host: "h", port: 22, username: "u", auth_type: "key", tags: [] }] },
    } as never;
    expect(await deriveScope(connApi, "connection_delete", { connectionId: "c1" })).toBe("c1");
    expect(await deriveScope(connApi, "connection_update", { connectionId: "nope" })).toBe(null);
  });

  it("scopes key_add_to_host (snake_case connection_id) to the connection it names", async () => {
    const connApi = {
      sessions: { list: () => [] },
      connections: { list: async () => [{ id: "c1", host: "h", port: 22, username: "u", auth_type: "key", tags: [] }] },
    } as never;
    expect(await deriveScope(connApi, "key_add_to_host", { connection_id: "c1" })).toBe("c1");
  });

  it("scopes key_add_to_host to a team-vault connection so its audit row reaches the team", async () => {
    const teamConnApi = {
      sessions: { list: () => [] },
      connections: {
        list: async () => [{ id: "team-c1", host: "h", port: 22, username: "u", auth_type: "key", tags: [], team: true }],
      },
    } as never;
    expect(await deriveScope(teamConnApi, "key_add_to_host", { connection_id: "team-c1" })).toBe("team-c1");
  });
});
