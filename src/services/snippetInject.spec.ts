import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalSession } from "@/types";

const h = vi.hoisted(() => ({
  broadcasting: new Set<string>(),
  controlledElsewhere: new Set<string>(),
  targets: [] as Pick<TerminalSession, "id" | "type">[],
  paste: vi.fn(async (_id: string, _text: string) => true),
  send: vi.fn(async (_id: string, _type: string, _data: Uint8Array) => {}),
}));
vi.mock("@/stores/layoutStore", () => ({ broadcastActiveForSession: (id: string) => h.broadcasting.has(id) }));
vi.mock("@/services/broadcast", () => ({
  broadcastTargets: () => h.targets,
  hasInputControl: (id: string) => !h.controlledElsewhere.has(id),
}));
vi.mock("@/services/terminalPaste", () => ({ pasteToSession: h.paste }));
vi.mock("@/services/sessionInput", () => ({ sendSessionInput: h.send }));

import { broadcastSnippetInject, snippetInject } from "./snippetInject";

const sent = () => h.send.mock.calls.map(([id, type, data]) => [id, type, new TextDecoder().decode(data)]);

describe("snippetInject", () => {
  beforeEach(() => {
    h.broadcasting = new Set();
    h.controlledElsewhere = new Set();
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

  it("execute writes nothing while another participant holds control", async () => {
    h.controlledElsewhere.add("s1");
    await snippetInject("s1", "ssh", "rm -rf build", true);
    expect(h.send).not.toHaveBeenCalled();
  });
});

describe("broadcastSnippetInject", () => {
  beforeEach(() => {
    h.paste.mockClear();
    h.send.mockClear();
    h.broadcasting = new Set(["a", "b"]);
    h.controlledElsewhere = new Set();
    h.targets = [{ id: "a", type: "ssh" }, { id: "b", type: "serial" }];
  });

  it("execute under broadcast reaches every target", async () => {
    await broadcastSnippetInject([{ id: "a", type: "ssh" }], "uptime", true);
    expect(sent()).toEqual([["a", "ssh", "uptime\n"], ["b", "serial", "uptime\n"]]);
  });

  it("insert under broadcast pastes once into the origin, whose terminal fans the input out", async () => {
    await broadcastSnippetInject([{ id: "a", type: "ssh" }], "uptime", false);
    expect(h.paste).toHaveBeenCalledTimes(1);
    expect(h.paste).toHaveBeenCalledWith("a", "uptime");
    expect(h.send).not.toHaveBeenCalled();
  });

  it("without broadcast only the origin is written", async () => {
    h.broadcasting = new Set();
    await broadcastSnippetInject([{ id: "a", type: "ssh" }], "uptime", true);
    expect(sent()).toEqual([["a", "ssh", "uptime\n"]]);
  });

  const both = [{ id: "a", type: "ssh" }, { id: "b", type: "serial" }] as const;

  it("execute into several broadcast panes writes each pane once", async () => {
    await broadcastSnippetInject([...both], "uptime", true);
    expect(sent()).toEqual([["a", "ssh", "uptime\n"], ["b", "serial", "uptime\n"]]);
  });

  it("insert into several broadcast panes pastes once", async () => {
    await broadcastSnippetInject([...both], "uptime", false);
    expect(h.paste.mock.calls).toEqual([["a", "uptime"]]);
  });

  it("a target outside the broadcast is written alongside the broadcast panes", async () => {
    await broadcastSnippetInject([{ id: "c", type: "local" }, ...both], "uptime", true);
    expect(sent()).toEqual([["c", "local", "uptime\n"], ["a", "ssh", "uptime\n"], ["b", "serial", "uptime\n"]]);
  });

  it("a target someone else controls neither receives the snippet nor starts a broadcast", async () => {
    h.broadcasting = new Set(["a"]);
    h.controlledElsewhere = new Set(["a", "c"]);
    h.targets = [];
    await broadcastSnippetInject([{ id: "a", type: "ssh" }, { id: "c", type: "local" }], "uptime", true);
    await broadcastSnippetInject([{ id: "a", type: "ssh" }], "uptime", false);
    expect(h.send).not.toHaveBeenCalled();
    expect(h.paste).not.toHaveBeenCalled();
  });
});
