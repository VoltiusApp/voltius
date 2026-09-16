import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Connection } from "@/types";

const h = vi.hoisted(() => ({
  canEdit: true,
  connections: [] as Connection[],
  session: undefined as undefined | { id: string; type: string; connectionId: string },
  updateConnection: vi.fn(async (_id: string, _data: unknown) => {}),
  inject: vi.fn(async () => {}),
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string, o?: { error?: string }) => (o?.error ? `${k}:${o.error}` : k) }) }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/hooks/usePermission", () => ({ usePermissions: () => () => h.canEdit }));
vi.mock("@/hooks/useActiveHostConnection", () => ({
  useActiveHostConnection: () => ({ session: h.session, connection: h.connections.find((c) => c.id === h.session?.connectionId) }),
}));
vi.mock("@/services/snippets", () => ({ broadcastSnippetInject: h.inject }));
vi.mock("@/stores/connectionStore", () => ({
  connectionToFormData: (c: Connection) => ({ name: c.name, host: c.host, notes: c.notes }),
  useConnectionStore: { getState: () => ({ connections: h.connections, teamConnections: {}, updateConnection: h.updateConnection }) },
}));
vi.mock("@/components/notes/NotesEditor", () => ({
  NotesEditor: (p: { value: string; onChange: (v: string) => void; readOnly?: boolean; onRunCode?: (c: string) => void }) => (
    <div>
      <textarea data-notes value={p.value} readOnly={p.readOnly} onChange={(e) => p.onChange(e.target.value)} />
      {p.onRunCode && <button onClick={() => p.onRunCode!("uptime")}>run</button>}
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
  h.session = { id: "s1", type: "ssh", connectionId: "c1" };
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

  test("send to terminal pastes without executing; multiplayer sessions get no button", () => {
    render(<NotesPanel />);
    fireEvent.click(screen.getByText("run"));
    expect(h.inject).toHaveBeenCalledWith("s1", "ssh", "uptime", false);
    cleanup();
    h.session = { id: "s3", type: "multiplayer", connectionId: "c1" };
    render(<NotesPanel />);
    expect(screen.queryByText("run")).toBeNull();
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
});
