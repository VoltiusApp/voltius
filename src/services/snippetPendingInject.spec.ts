import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Snippet, TerminalSession } from "@/types";
import type { SnippetPendingInject } from "./snippetRunCore";

const inject = vi.fn(async (_id: string, _type: string, _text: string, _execute: boolean) => {});
vi.mock("@/services/snippets", () => ({
  broadcastSnippetInject: (...a: [string, string, string, boolean]) => inject(...a),
}));

let sessions: TerminalSession[] = [];
vi.mock("@/stores/sessionStore", () => ({
  useSessionStore: { getState: () => ({ sessions }) },
}));

const addRecent = vi.fn();
vi.mock("@/stores/snippetRecentStore", () => ({
  useSnippetRecentStore: { getState: () => ({ add: addRecent }) },
}));

import { injectPendingSnippet } from "./snippetPendingInject";

const snippet = { id: "s1", name: "port check" } as Snippet;

function mkSession(over: Partial<TerminalSession>): TerminalSession {
  return {
    id: "sess1", type: "ssh", status: "connected", connectionId: "c1",
    connectionName: "web01", ...over,
  } as TerminalSession;
}

function mkPending(over: Partial<SnippetPendingInject> = {}): SnippetPendingInject {
  return {
    snippet, userVars: [], partialTemplate: "", initialValues: {},
    execute: true, sessionIds: ["sess1"], ...over,
  };
}

describe("injectPendingSnippet", () => {
  beforeEach(() => {
    inject.mockClear();
    addRecent.mockClear();
    sessions = [mkSession({})];
  });

  it("injects into every target session", async () => {
    sessions = [mkSession({}), mkSession({ id: "sess2", connectionId: "c2", connectionName: "db01" })];
    await injectPendingSnippet(mkPending({ sessionIds: ["sess1", "sess2"] }), "ss -tulpn", true);
    expect(inject.mock.calls.map(c => [c[0], c[2], c[3]])).toEqual([
      ["sess1", "ss -tulpn", true],
      ["sess2", "ss -tulpn", true],
    ]);
  });

  it("records the run in recents, so a prompted snippet is not lost from the list", async () => {
    await injectPendingSnippet(mkPending(), "ss -tulpn", true);
    expect(addRecent).toHaveBeenCalledTimes(1);
    expect(addRecent.mock.calls[0][0]).toMatchObject({
      snippetId: "s1",
      execute: true,
      targets: [{ connectionId: "c1", connectionName: "web01", sessionType: "ssh" }],
    });
  });

  // The prompt can be answered after the page that opened it navigated to the
  // terminal, by which point the picked session may be gone.
  it("does nothing when no target session survives", async () => {
    sessions = [];
    await injectPendingSnippet(mkPending(), "ss -tulpn", true);
    expect(inject).not.toHaveBeenCalled();
    expect(addRecent).not.toHaveBeenCalled();
  });

  it("falls back to the first runnable session when the prompt carries no target", async () => {
    sessions = [
      mkSession({ id: "mirror", type: "multiplayer" }),
      mkSession({ id: "sess2", connectionName: "db01" }),
    ];
    await injectPendingSnippet(mkPending({ sessionIds: [] }), "ss -tulpn", false);
    expect(inject.mock.calls.map(c => c[0])).toEqual(["sess2"]);
  });
});
