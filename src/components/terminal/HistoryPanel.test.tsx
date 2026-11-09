import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const disk = vi.hoisted(() => ({ items: [] as Array<Record<string, unknown>> }));

vi.mock("@/lib/invoke", () => ({
  invoke: vi.fn(async (cmd: string, args?: { entry: Record<string, unknown> }) => {
    if (cmd === "favorite_command_list") return structuredClone(disk.items);
    if (cmd === "favorite_command_put") {
      const i = disk.items.findIndex((it) => it.id === args!.entry.id);
      if (i >= 0) disk.items[i] = args!.entry;
      else disk.items.push(args!.entry);
    }
    return undefined;
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@/stores/syncAfterEdit", () => ({ syncAfterEdit: vi.fn() }));
vi.mock("@/services/snippetInject", () => ({ broadcastSnippetInject: vi.fn(async () => {}) }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, o?: { count?: number; host?: string }) =>
      o?.count !== undefined ? `${key}:${o.count}` : o?.host !== undefined ? `${key}:${o.host}` : key,
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

import { HistoryPanel } from "./HistoryPanel";
import { useCommandHistoryStore, type CommandHistoryEntry } from "@/stores/commandHistoryStore";
import { useFavoriteCommandStore } from "@/stores/favoriteCommandStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useSnippetStore } from "@/stores/snippetStore";
import { useUIStore } from "@/stores/uiStore";
import type { Connection } from "@/types";

const entry = (id: string, command: string, connectionId: string, sessionName: string): CommandHistoryEntry => ({
  id, command, connectionId, sessionName, sessionId: "s-old", timestamp: Date.now() - 60_000,
});

const conn = (id: string, name: string) => ({ id, name } as Connection);

async function renderPanel() {
  render(<HistoryPanel />);
  await act(async () => {});
}

const rowOf = (command: string) => screen.getByText(command, { selector: "p" }).closest(".group") as HTMLElement;
async function star(command: string) {
  const before = useFavoriteCommandStore.getState().favorites.length;
  fireEvent.click(within(rowOf(command)).getByLabelText(/terminal\.historyPanel\.addFavorite/));
  await waitFor(() => expect(useFavoriteCommandStore.getState().favorites.length).toBe(before + 1));
}

const groupLabels = () => [...document.querySelectorAll(".uppercase")].map((el) => el.textContent);

describe("HistoryPanel", () => {
  beforeEach(() => {
    disk.items = [];
    useFavoriteCommandStore.setState({ favorites: [] });
    useCommandHistoryStore.setState({
      entries: [entry("h1", "uptime", "c1", "db-old"), entry("h2", "df -h", "c2", "web"), entry("h3", "ls", "c1", "db-old")],
    });
    useConnectionStore.setState({ connections: [conn("c1", "prod-db"), conn("c2", "web-01")], teamConnections: {} });
    useSessionStore.setState({
      sessions: [{ id: "s1", status: "connected", connectionId: "c2", connectionName: "web-01", type: "ssh" }],
      activeSessionId: "s1",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    useSnippetStore.setState({ snippetDraft: null });
  });
  afterEach(cleanup);

  test("starring a command moves it from Recent into Favorites, and unstarring puts it back", async () => {
    await renderPanel();
    expect(groupLabels()).toEqual([]);

    await star("uptime");
    expect(groupLabels()).toEqual(["terminal.historyPanel.favorites1", "terminal.historyPanel.recent2"]);
    expect(screen.getAllByText("uptime", { selector: "p" })).toHaveLength(1);

    await act(async () => fireEvent.click(within(rowOf("uptime")).getByLabelText("terminal.historyPanel.removeFavorite")));
    expect(groupLabels()).toEqual([]);
    expect(rowOf("uptime")).toBeTruthy();
  });

  test("rows show the host's current name, not the session name stored with the entry", async () => {
    await renderPanel();
    expect(within(rowOf("uptime")).getByText("prod-db")).toBeTruthy();
  });

  test("clicking a host name filters to that host with a removable chip", async () => {
    await renderPanel();
    fireEvent.click(within(rowOf("uptime")).getByText("prod-db"));
    expect(screen.queryByText("df -h")).toBeNull();
    expect(screen.getByText("ls")).toBeTruthy();
    expect(screen.getByTitle("terminal.historyPanel.showCurrentHost").getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(screen.getByLabelText("terminal.historyPanel.clearHostFilter"));
    expect(screen.getByText("df -h")).toBeTruthy();
  });

  test("the current-host button sets the same chip, replacing another host's", async () => {
    await renderPanel();
    fireEvent.click(within(rowOf("uptime")).getByText("prod-db"));
    fireEvent.click(screen.getByTitle("terminal.historyPanel.showCurrentHost"));
    expect(screen.queryByText("uptime")).toBeNull();
    expect(screen.getByText("df -h")).toBeTruthy();
    const button = screen.getByTitle("terminal.historyPanel.showAllConnections");
    expect(button.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(button);
    expect(screen.getByText("uptime")).toBeTruthy();
  });

  test("search and the host chip apply to favorites too", async () => {
    await renderPanel();
    await star("df -h");
    fireEvent.click(within(rowOf("uptime")).getByText("prod-db"));
    expect(screen.queryByText("df -h")).toBeNull();
    expect(groupLabels()[0]).toBe("terminal.historyPanel.favorites0");
  });

  test("clear all says favorites stay, and keeps them", async () => {
    await renderPanel();
    await star("uptime");
    fireEvent.click(screen.getByTitle("terminal.historyPanel.clearAllTitle"));
    expect(screen.getByText(/terminal\.historyPanel\.clearConfirm:2/).textContent).toContain("terminal.historyPanel.favoritesStay:1");

    fireEvent.click(screen.getByText("terminal.historyPanel.clear"));
    expect(useCommandHistoryStore.getState().entries).toEqual([]);
    expect(screen.getByText("uptime")).toBeTruthy();
  });

  test("removing a favorite from its menu also drops that command from history", async () => {
    await renderPanel();
    await star("uptime");
    fireEvent.contextMenu(rowOf("uptime"));
    await act(async () => fireEvent.click(screen.getByText("common.action.remove")));
    expect(useFavoriteCommandStore.getState().favorites).toEqual([]);
    expect(useCommandHistoryStore.getState().entries.map((e) => e.command)).toEqual(["df -h", "ls"]);
  });

  test("Save as snippet hands the command to the Snippets panel", async () => {
    await renderPanel();
    fireEvent.click(within(rowOf("df -h")).getByLabelText("common.action.moreOptions"));
    fireEvent.click(screen.getByText("terminal.historyPanel.saveAsSnippet"));
    expect(useSnippetStore.getState().snippetDraft).toEqual({ name: "df -h", steps: [{ kind: "script", content: "df -h" }] });
    expect(useUIStore.getState().rightPanelSection).toBe("snippets");
  });

  test("a team host's star warns that the favorite outlives team access", async () => {
    useConnectionStore.setState({ teamConnections: { t1: [conn("c2", "web-01")] } });
    await renderPanel();
    expect(within(rowOf("df -h")).getByLabelText("terminal.historyPanel.addFavoriteTeam")).toBeTruthy();
    expect(within(rowOf("uptime")).getByLabelText("terminal.historyPanel.addFavorite")).toBeTruthy();
  });
});
