import { describe, it, expect } from "vitest";
import { resolveScopeLabel, scopeLabelText } from "./connectionLabels";
import { UNKNOWN_SCOPE } from "./scopeDerivation";
import type { PluginConnection } from "@/plugins/api";

const CONNS = [
  { id: "c1", name: "Prod DB", host: "web-01", port: 22, username: "deploy", auth_type: "key", tags: [] },
  { id: "c2", name: "  ", host: "web-01", port: 2222, username: "root", auth_type: "key", tags: [] },
] as PluginConnection[];

describe("resolveScopeLabel", () => {
  it("uses the connection name and shows user@host:port as detail", () => {
    expect(resolveScopeLabel("c1", CONNS)).toEqual({
      kind: "connection", name: "Prod DB", detail: "deploy@web-01:22",
    });
  });

  it("falls back to user@host:port when the name is blank", () => {
    expect(resolveScopeLabel("c2", CONNS)).toEqual({
      kind: "connection", name: "root@web-01:2222", detail: null,
    });
  });

  it("marks the local scope", () => {
    expect(resolveScopeLabel("local", CONNS)).toEqual({ kind: "local", name: "local", detail: null });
  });

  it("marks the unknown sentinel", () => {
    expect(resolveScopeLabel(UNKNOWN_SCOPE, CONNS)).toEqual({ kind: "unknown", name: UNKNOWN_SCOPE, detail: null });
  });

  it("marks a deleted connection and keeps the raw id visible", () => {
    expect(resolveScopeLabel("gone", CONNS)).toEqual({ kind: "deleted", name: "gone", detail: "gone" });
  });
});

describe("scopeLabelText", () => {
  const t = (k: string) => k;
  it("translates the three non-connection kinds and passes through a real name", () => {
    expect(scopeLabelText({ kind: "local", name: "local", detail: null }, t)).toBe("aiAgent.settings.allowlist.localScope");
    expect(scopeLabelText({ kind: "unknown", name: "x", detail: null }, t)).toBe("aiAgent.settings.allowlist.unknownScope");
    expect(scopeLabelText({ kind: "deleted", name: "gone", detail: "gone" }, t)).toBe("aiAgent.settings.allowlist.deletedConnection");
    expect(scopeLabelText({ kind: "connection", name: "Prod DB", detail: "deploy@web-01:22" }, t)).toBe("Prod DB");
  });
});
