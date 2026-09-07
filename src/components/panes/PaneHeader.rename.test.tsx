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

  it("Escape leaves the session as it was", () => {
    render(<PaneHeader paneId="p1" session={session} active />);
    fireEvent.doubleClick(screen.getByText("web-1"));
    fireEvent.change(editor(), { target: { value: "deploy" } });
    fireEvent.keyDown(editor(), { key: "Escape" });

    expect(titleOf()).toBeUndefined();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
