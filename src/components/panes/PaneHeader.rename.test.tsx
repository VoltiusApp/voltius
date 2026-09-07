import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { useSessionStore } from "@/stores/sessionStore";
import { PaneHeader } from "./PaneHeader";
import type { TerminalSession } from "@/types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
const focusSession = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useTerminal", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useTerminal")>("@/hooks/useTerminal");
  return { ...actual, focusSession };
});
vi.mock("@/utils/icons", () => ({
  getConnectionIcon: () => null,
  getConnectionIconColor: () => null,
  getDistroColor: () => null,
  getDistroIcon: () => "lucide:server",
  getDistroLabel: () => "",
}));

const session: TerminalSession = {
  id: "s1", connectionId: "c1", connectionName: "web-1", status: "connected", type: "local",
};

beforeEach(() => {
  focusSession.mockClear();
  useSessionStore.setState({ sessions: [session], activeSessionId: "s1" });
});
afterEach(cleanup);

const editor = () => screen.getByRole("textbox") as HTMLInputElement;
const titleOf = () => useSessionStore.getState().sessions[0].title;

describe("renaming from the pane header", () => {
  it("shows the name the session was given", () => {
    render(<PaneHeader paneId="p1" session={{ ...session, title: "deploy" }} active />);
    expect(screen.getByText("deploy")).toBeTruthy();
    expect(screen.queryByText("web-1")).toBeNull();
  });

  it("double-clicking the title renames the session", () => {
    render(<PaneHeader paneId="p1" session={session} active />);
    fireEvent.doubleClick(screen.getByText("web-1"));
    fireEvent.change(editor(), { target: { value: "deploy" } });
    fireEvent.keyDown(editor(), { key: "Enter" });

    expect(titleOf()).toBe("deploy");
  });

  it("keeps the editor out of any button, where Space would activate it", () => {
    render(<PaneHeader paneId="p1" session={session} active />);
    fireEvent.doubleClick(screen.getByText("web-1"));
    expect(editor().closest("button")).toBeNull();
  });

  it("hands focus back to the pane's terminal when the editor closes", () => {
    render(<PaneHeader paneId="p1" session={session} active />);
    fireEvent.doubleClick(screen.getByText("web-1"));
    fireEvent.keyDown(editor(), { key: "Escape" });
    expect(focusSession).toHaveBeenCalledWith("s1");

    focusSession.mockClear();
    fireEvent.doubleClick(screen.getByText("web-1"));
    fireEvent.keyDown(editor(), { key: "Enter" });
    expect(focusSession).toHaveBeenCalledWith("s1");
  });

  it("Escape leaves the session as it was", () => {
    render(<PaneHeader paneId="p1" session={session} active />);
    fireEvent.doubleClick(screen.getByText("web-1"));
    fireEvent.change(editor(), { target: { value: "deploy" } });
    fireEvent.keyDown(editor(), { key: "Escape" });

    expect(titleOf()).toBeUndefined();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
