import { describe, it, expect } from "vitest";
import { resolveHostCommand, inlineCommandForBackend } from "./hostCommand";
import type { Connection } from "@/types";

function mkConn(over: Partial<Connection>): Connection {
  return {
    id: "c", host: "h", port: 22, username: "u", auth_type: "password",
    tags: [], created_at: "", last_used_at: null, vault_id: "personal", clocks: {},
    updated_at: "", ...over,
  } as Connection;
}

describe("resolveHostCommand", () => {
  it("returns null when neither field is set", () => {
    expect(resolveHostCommand(mkConn({}), "pre")).toBeNull();
    expect(resolveHostCommand(mkConn({}), "post")).toBeNull();
  });

  it("returns inline for a plain string", () => {
    expect(resolveHostCommand(mkConn({ pre_command: "uptime" }), "pre"))
      .toEqual({ kind: "inline", text: "uptime" });
  });

  it("treats a blank or whitespace-only string as unset", () => {
    expect(resolveHostCommand(mkConn({ pre_command: "   " }), "pre")).toBeNull();
  });

  it("returns snippet when a snippet id is set", () => {
    expect(resolveHostCommand(mkConn({ pre_snippet_id: "s1" }), "pre"))
      .toEqual({ kind: "snippet", id: "s1" });
  });

  it("prefers the snippet id when both are set", () => {
    expect(resolveHostCommand(mkConn({ pre_command: "uptime", pre_snippet_id: "s1" }), "pre"))
      .toEqual({ kind: "snippet", id: "s1" });
  });

  it("reads the post slot independently of the pre slot", () => {
    const conn = mkConn({ pre_snippet_id: "s1", post_command: "sync" });
    expect(resolveHostCommand(conn, "post")).toEqual({ kind: "inline", text: "sync" });
  });
});

describe("inlineCommandForBackend", () => {
  it("passes an inline command through", () => {
    expect(inlineCommandForBackend(mkConn({ pre_command: "uptime" }), "pre")).toBe("uptime");
    expect(inlineCommandForBackend(mkConn({ post_command: "sync" }), "post")).toBe("sync");
  });

  it("withholds it in snippet mode so nothing races the frontend run", () => {
    expect(inlineCommandForBackend(mkConn({ pre_snippet_id: "s1" }), "pre")).toBeUndefined();
  });

  it("withholds it when a stale inline string sits behind a snippet id", () => {
    expect(inlineCommandForBackend(mkConn({ pre_command: "uptime", pre_snippet_id: "s1" }), "pre"))
      .toBeUndefined();
  });

  it("is undefined when nothing is configured", () => {
    expect(inlineCommandForBackend(mkConn({}), "pre")).toBeUndefined();
    expect(inlineCommandForBackend(mkConn({}), "post")).toBeUndefined();
  });
});
