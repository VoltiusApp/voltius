import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { useSessionStore } from "@/stores/sessionStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { useDragStore } from "@/stores/dragStore";
import { useUIStore } from "@/stores/uiStore";
import TitleBar from "./TitleBar";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    startDragging: vi.fn(),
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/utils/icons", () => ({ getConnectionIcon: () => null, getConnectionIconColor: () => null }));

const focusSession = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useTerminal", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useTerminal")>("@/hooks/useTerminal");
  return { ...actual, focusSession };
});

const session = (id: string) => ({
  id, connectionId: `conn-${id}`, connectionName: id, status: "connected" as const, type: "local" as const,
});

beforeEach(() => {
  focusSession.mockClear();
  useUIStore.setState({ activeNav: "terminal" });
  useDragStore.setState({ lastDragEndedAt: 0, isDragging: false });
  useSessionStore.setState({ sessions: [session("s1"), session("s2")], activeSessionId: "s1" });
  useLayoutStore.setState({ splitTabs: [], activeSplitTabId: null, root: null, splitTabActive: false, titlebarOrder: [] });
});
afterEach(cleanup);

const editor = () => screen.getByRole("textbox") as HTMLInputElement;
const titleOf = (id: string) => useSessionStore.getState().sessions.find((s) => s.id === id)?.title;

describe("renaming a session tab", () => {
  it("shows the name the user gave the tab instead of the connection", () => {
    useSessionStore.getState().renameSession("s1", "deploy");
    render(<TitleBar />);
    expect(screen.getByText("deploy")).toBeTruthy();
    expect(screen.queryByText("s1")).toBeNull();
  });

  it("double-clicking the tab opens the editor on the current label", () => {
    render(<TitleBar />);
    fireEvent.doubleClick(screen.getByText("s1"));
    expect(editor().value).toBe("s1");
  });

  it("committing renames that session alone", () => {
    render(<TitleBar />);
    fireEvent.doubleClick(screen.getByText("s1"));
    fireEvent.change(editor(), { target: { value: "deploy" } });
    fireEvent.keyDown(editor(), { key: "Enter" });

    expect(titleOf("s1")).toBe("deploy");
    expect(titleOf("s2")).toBeUndefined();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  /**
   * Live bug: with the input nested in the tab <button>, WebKit activated the
   * button on Space — the tab took focus, the editor blurred and committed a
   * half-typed name, and the rest of the keystrokes went into the terminal.
   */
  it("does not put the editor inside the tab button, where Space activates the tab", () => {
    render(<TitleBar />);
    fireEvent.doubleClick(screen.getByText("s1"));
    expect(editor().closest("button")).toBeNull();
  });

  it("an emptied field returns the tab to its connection name", () => {
    useSessionStore.getState().renameSession("s1", "deploy");
    render(<TitleBar />);
    fireEvent.doubleClick(screen.getByText("deploy"));
    fireEvent.change(editor(), { target: { value: "" } });
    fireEvent.keyDown(editor(), { key: "Enter" });

    expect(titleOf("s1")).toBeUndefined();
    expect(screen.getByText("s1")).toBeTruthy();
  });

  /** Renaming must not cost the user their cursor: the terminal takes focus back. */
  it("hands focus back to the terminal after a commit", () => {
    render(<TitleBar />);
    fireEvent.doubleClick(screen.getByText("s1"));
    fireEvent.change(editor(), { target: { value: "deploy" } });
    fireEvent.keyDown(editor(), { key: "Enter" });

    expect(focusSession).toHaveBeenCalledWith("s1");
  });

  it("hands focus back to the terminal after a cancel", () => {
    render(<TitleBar />);
    fireEvent.doubleClick(screen.getByText("s1"));
    fireEvent.keyDown(editor(), { key: "Escape" });

    expect(focusSession).toHaveBeenCalledWith("s1");
  });

  /** Right-click is not findable; a click on the name of the tab you are already
   *  on is the discoverable gesture. A background tab still just activates. */
  it("clicking the name of the active tab opens the editor", () => {
    render(<TitleBar />);
    fireEvent.click(screen.getByText("s1"));
    expect(editor().value).toBe("s1");
  });

  it("clicking the name of a background tab switches to it instead", () => {
    render(<TitleBar />);
    fireEvent.click(screen.getByText("s2"));

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(useSessionStore.getState().activeSessionId).toBe("s2");
  });

  it("does not open the editor on the click that ends a tab drag", () => {
    render(<TitleBar />);
    useDragStore.setState({ lastDragEndedAt: Date.now() });
    fireEvent.click(screen.getByText("s1"));
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("Escape leaves the tab as it was", () => {
    render(<TitleBar />);
    fireEvent.doubleClick(screen.getByText("s1"));
    fireEvent.change(editor(), { target: { value: "deploy" } });
    fireEvent.keyDown(editor(), { key: "Escape" });

    expect(titleOf("s1")).toBeUndefined();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});

describe("renaming a split tab", () => {
  const splitTab = () => useLayoutStore.getState().splitTabs[0];

  beforeEach(() => {
    useLayoutStore.getState().createSplitTab("s1", "s2", "right");
  });

  it("names the tab itself, leaving the sessions inside it alone", () => {
    render(<TitleBar />);
    fireEvent.doubleClick(screen.getByText(/^s[12]/));
    fireEvent.change(editor(), { target: { value: "prod" } });
    fireEvent.keyDown(editor(), { key: "Enter" });

    expect(splitTab().name).toBe("prod");
    expect(titleOf("s1")).toBeUndefined();
  });

  it("does not put the editor inside the tab button, where Space activates the tab", () => {
    render(<TitleBar />);
    fireEvent.doubleClick(screen.getByText(/^s[12]/));
    expect(editor().closest("button")).toBeNull();
  });

  it("hands focus back to the pane that was active in the split", () => {
    render(<TitleBar />);
    const activeLeafSession = useLayoutStore.getState().splitTabs[0];
    expect(activeLeafSession).toBeTruthy();
    fireEvent.doubleClick(screen.getByText(/^s[12]/));
    fireEvent.keyDown(editor(), { key: "Enter" });

    expect(focusSession).toHaveBeenCalled();
  });

  it("clicking the name of the active split tab opens the editor", () => {
    useLayoutStore.setState({ splitTabActive: true });
    render(<TitleBar />);
    fireEvent.click(screen.getByText(/^s[12]/));
    expect(editor()).toBeTruthy();
  });

  it("a named split tab stops following the active pane", () => {
    useLayoutStore.getState().renameSplitTab(splitTab().id, "prod");
    render(<TitleBar />);
    expect(screen.getByText(/^prod/)).toBeTruthy();
  });
});
