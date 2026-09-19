import { describe, expect, it } from "vitest";
import type { TerminalSession } from "@/types";
import type { SplitTab } from "@/stores/layoutStore";
import {
  buildTitlebarItems, hostSessionsInOrder, resolveTitlebarTarget, shownMember,
  stackKey, stackMemberKeys, stackMemberLabels, visibleTitlebarKeys, worstStatus,
} from "./titlebarItems";

const s = (id: string, connectionId: string, extra: Partial<TerminalSession> = {}): TerminalSession => ({
  id, connectionId, connectionName: connectionId, status: "connected", type: "ssh", ...extra,
} as TerminalSession);

const web1 = s("w1", "web"), web2 = s("w2", "web", { title: "logs" }), web3 = s("w3", "web");
const db1 = s("d1", "db");
const sessions = [web1, web2, web3, db1];
const keysOf = (...ids: string[]) => ids.map((id) => `session:${id}`);
const connectionOf = (id: string) => sessions.find((x) => x.id === id)?.connectionId;

describe("buildTitlebarItems", () => {
  it("renders flat tabs when grouping is off", () => {
    const items = buildTitlebarItems(keysOf("w1", "d1", "w2"), sessions, [], false);
    expect(items.map((i) => i.key)).toEqual(keysOf("w1", "d1", "w2"));
  });

  it("stacks a host with 2+ sessions at its first member's position", () => {
    const items = buildTitlebarItems(keysOf("d1", "w1", "w2", "w3"), sessions, [], true);
    expect(items.map((i) => i.key)).toEqual(["session:d1", stackKey("web")]);
    const stack = items[1];
    expect(stack.type === "stack" && stack.members.map((m) => m.id)).toEqual(["w1", "w2", "w3"]);
  });

  it("keeps a single-session host as a plain tab", () => {
    const items = buildTitlebarItems(keysOf("d1", "w1"), sessions, [], true);
    expect(items.map((i) => i.type)).toEqual(["session", "session"]);
  });

  it("passes split keys through and ignores unknown keys", () => {
    const tab = { id: "t1" } as SplitTab;
    const items = buildTitlebarItems(["split:t1", "session:gone", ...keysOf("d1")], sessions, [tab], true);
    expect(items.map((i) => i.key)).toEqual(["split:t1", "session:d1"]);
  });
});

describe("stack key resolution", () => {
  const order = keysOf("d1", "w1", "w2", "w3");

  it("expands a stack key to its member keys in order", () => {
    expect(stackMemberKeys(order, stackKey("web"), connectionOf)).toEqual(keysOf("w1", "w2", "w3"));
  });

  it("returns a plain key unchanged", () => {
    expect(stackMemberKeys(order, "session:d1", connectionOf)).toEqual(["session:d1"]);
  });

  it("targets the first member before a stack and the last member after it", () => {
    expect(resolveTitlebarTarget(order, stackKey("web"), "before", connectionOf)).toBe("session:w1");
    expect(resolveTitlebarTarget(order, stackKey("web"), "after", connectionOf)).toBe("session:w3");
    expect(resolveTitlebarTarget(order, null, "after", connectionOf)).toBeNull();
  });
});

describe("stackMemberLabels", () => {
  it("numbers untitled members in open order and never numbers a titled one", () => {
    const labels = stackMemberLabels([web1, web2, web3]);
    expect(labels.get("w1")).toEqual({ label: "web", number: 1 });
    expect(labels.get("w2")).toEqual({ label: "logs", number: 0 });
    expect(labels.get("w3")).toEqual({ label: "web (2)", number: 2 });
  });

  it("renumbers when a member is gone", () => {
    expect(stackMemberLabels([web3]).get("w3")).toEqual({ label: "web", number: 1 });
  });
});

describe("worstStatus", () => {
  it("prefers error, then connecting, then disconnected, then connected", () => {
    expect(worstStatus([web1, s("x", "web", { status: "connecting" })])).toBe("connecting");
    expect(worstStatus([s("x", "web", { status: "connecting" }), s("y", "web", { status: "error" })])).toBe("error");
    expect(worstStatus([web1, s("z", "web", { status: "disconnected" })])).toBe("disconnected");
    expect(worstStatus([web1])).toBe("connected");
  });
});

describe("shownMember", () => {
  it("is the active session when it belongs to the stack", () => {
    expect(shownMember([web1, web2], "w2", undefined)?.id).toBe("w2");
  });

  it("falls back to the last active member, then the first", () => {
    expect(shownMember([web1, web2], "d1", "w2")?.id).toBe("w2");
    expect(shownMember([web1, web2], "d1", "gone")?.id).toBe("w1");
  });

  it("is undefined for an empty member list", () => {
    expect(shownMember([], "w2", undefined)).toBeUndefined();
  });
});

describe("hostSessionsInOrder", () => {
  it("lists a host's sessions in bar order, split members at their split's slot", () => {
    const tab = { id: "t1", root: { type: "leaf", id: "p1", sessionId: "w3" } } as unknown as SplitTab;
    const rows = hostSessionsInOrder(["session:w1", "split:t1", "session:d1", "session:w2"], sessions, [tab], "web");
    expect(rows.map((r) => [r.session.id, r.splitTabId])).toEqual([["w1", null], ["w3", "t1"], ["w2", null]]);
  });
});

describe("visibleTitlebarKeys", () => {
  it("puts split tabs first, then sessions not already inside a split", () => {
    const tab = { id: "t1", root: { type: "leaf", id: "p1", sessionId: "w3" } } as unknown as SplitTab;
    expect(visibleTitlebarKeys(sessions, [tab])).toEqual(["split:t1", "session:w1", "session:w2", "session:d1"]);
  });

  it("is just the sessions when there are no split tabs", () => {
    expect(visibleTitlebarKeys([web1, db1], [])).toEqual(["session:w1", "session:d1"]);
  });
});
