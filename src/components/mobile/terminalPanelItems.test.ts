// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import { terminalPanelItems } from "./terminalPanelItems";
import type { TerminalPanel } from "@/components/terminal/terminalPanels";

const PANELS: TerminalPanel[] = [
  { id: "snippets", icon: "a", title: "Snippets" },
  { id: "history", icon: "b", title: "History" },
  { id: "notes", icon: "c", title: "Notes" },
  { id: "themes", icon: "d", title: "Themes", desktopOnly: true },
  { id: "ports", icon: "e", title: "Ports" },
  { id: "sftp", icon: "f", title: "SFTP" },
  { id: "plugin:proxmox:proxmox", icon: "g", title: "Proxmox" },
  { id: "plugin:acme:widget", icon: "h", title: "Widget" },
];

function itemsFor(connectionIdOfActive: string | undefined) {
  const nav = { push: vi.fn(), openSheet: vi.fn() };
  const items = terminalPanelItems(PANELS, { activeSessionId: "s1", connectionIdOfActive, nav });
  const tap = (key: string) => items.find((i) => i.key === key)!.onTap();
  return { items, nav, tap };
}

describe("terminalPanelItems", () => {
  test("lists every desktop panel except desktop-only ones, in rail order, with the same icon", () => {
    const { items } = itemsFor("c1");
    expect(items.map((i) => i.key)).toEqual([
      "snippets", "history", "notes", "ports", "sftp", "plugin:proxmox:proxmox", "plugin:acme:widget",
    ]);
    expect(items.find((i) => i.key === "sftp")!.icon).toBe("f");
  });

  test("history, notes and plugin panels open the panel page for the active session", () => {
    const { nav, tap } = itemsFor("c1");
    tap("history");
    tap("notes");
    tap("plugin:proxmox:proxmox");
    tap("plugin:acme:widget");
    expect(nav.push.mock.calls.map(([s]) => s)).toEqual([
      { kind: "panel", section: "history", sessionId: "s1" },
      { kind: "panel", section: "notes", sessionId: "s1" },
      { kind: "panel", section: "plugin:proxmox:proxmox", sessionId: "s1" },
      { kind: "panel", section: "plugin:acme:widget", sessionId: "s1" },
    ]);
  });

  test("snippets, SFTP and ports keep their native mobile screens", () => {
    const { nav, tap } = itemsFor("c1");
    tap("snippets");
    tap("sftp");
    tap("ports");
    expect(nav.openSheet).toHaveBeenCalledWith({ kind: "snippets", sessionId: "s1" });
    expect(nav.push.mock.calls.map(([s]) => s)).toEqual([
      { kind: "panel-sftp", connectionId: "c1" },
      { kind: "more-page", page: "port-forwarding" },
    ]);
  });

  test("SFTP does nothing for a session without a saved host", () => {
    const { nav, tap } = itemsFor(undefined);
    tap("sftp");
    expect(nav.push).not.toHaveBeenCalled();
  });
});
