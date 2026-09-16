import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalSession } from "@/types";

const h = vi.hoisted(() => ({
  broadcast: false,
  targets: [] as Pick<TerminalSession, "id" | "type">[],
  paste: vi.fn(async (_id: string, _text: string) => true),
  send: vi.fn(async (_id: string, _type: string, _data: Uint8Array) => {}),
}));
vi.mock("@/stores/layoutStore", () => ({ broadcastActiveForSession: () => h.broadcast }));
vi.mock("@/services/broadcast", () => ({ broadcastTargets: () => h.targets }));
vi.mock("@/services/terminalPaste", () => ({ pasteToSession: h.paste }));
vi.mock("@/services/sessionInput", () => ({ sendSessionInput: h.send }));

import { broadcastSnippetInject, snippetInject } from "./snippetInject";

const sent = () => h.send.mock.calls.map(([id, type, data]) => [id, type, new TextDecoder().decode(data)]);

describe("snippetInject", () => {
  beforeEach(() => {
    h.broadcast = false;
    h.targets = [];
    h.paste.mockClear();
    h.send.mockClear();
  });

  it("insert pastes a multi-line snippet instead of writing raw bytes", async () => {
    await snippetInject("s1", "ssh", "echo one\necho two", false);
    expect(h.paste).toHaveBeenCalledWith("s1", "echo one\necho two");
    expect(h.send).not.toHaveBeenCalled();
  });

  it("insert works on serial sessions", async () => {
    await snippetInject("tty", "serial", "AT\r\nATI", false);
    expect(h.paste).toHaveBeenCalledWith("tty", "AT\r\nATI");
  });

  it.each(["ssh", "local", "serial"] as const)("execute on %s writes the command plus one newline", async (type) => {
    await snippetInject("s1", type, "ls -la", true);
    expect(sent()).toEqual([["s1", type, "ls -la\n"]]);
    expect(h.paste).not.toHaveBeenCalled();
  });

  it("execute keeps multi-line text verbatim", async () => {
    await snippetInject("s1", "ssh", "cd /tmp\nls", true);
    expect(sent()).toEqual([["s1", "ssh", "cd /tmp\nls\n"]]);
  });
});

describe("broadcastSnippetInject", () => {
  beforeEach(() => {
    h.paste.mockClear();
    h.send.mockClear();
    h.broadcast = true;
    h.targets = [{ id: "a", type: "ssh" }, { id: "b", type: "serial" }];
  });

  it("execute under broadcast reaches every target", async () => {
    await broadcastSnippetInject("a", "ssh", "uptime", true);
    expect(sent()).toEqual([["a", "ssh", "uptime\n"], ["b", "serial", "uptime\n"]]);
  });

  it("insert under broadcast pastes once into the origin, whose terminal fans the input out", async () => {
    await broadcastSnippetInject("a", "ssh", "uptime", false);
    expect(h.paste).toHaveBeenCalledTimes(1);
    expect(h.paste).toHaveBeenCalledWith("a", "uptime");
    expect(h.send).not.toHaveBeenCalled();
  });

  it("without broadcast only the origin is written", async () => {
    h.broadcast = false;
    await broadcastSnippetInject("a", "ssh", "uptime", true);
    expect(sent()).toEqual([["a", "ssh", "uptime\n"]]);
  });
});
