import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import MobileTerminalPanelScreen from "./MobileTerminalPanelScreen";
import { usePluginStore } from "@/stores/pluginStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/components/terminal/SnippetsPanel", () => ({ SnippetsPanel: () => <div>snippets-panel</div> }));
vi.mock("@/components/terminal/PortsPanel", () => ({ PortsPanel: () => <div>ports-panel</div> }));
vi.mock("@/components/terminal/HistoryPanel", () => ({
  HistoryPanel: ({ onInjected }: { onInjected?: () => void }) => <button onClick={onInjected}>history-panel</button>,
}));
vi.mock("@/components/terminal/PanelSftpSection", () => ({ default: () => <div>sftp-panel</div> }));
vi.mock("@/components/terminal/NotesPanel", () => ({ NotesPanel: () => <div>notes-panel</div> }));

const section = (id: string) => ({ id, label: "Widget", icon: "x", component: () => <div>desktop-widget</div> });

describe("MobileTerminalPanelScreen", () => {
  beforeEach(() => {
    usePluginStore.setState({ rightPanelSections: new Map(), mobileScreens: new Map() });
    useSessionStore.setState({
      sessions: [{ id: "s1", status: "connected", connectionId: "c1", connectionName: "web-01", type: "ssh" }],
      activeSessionId: "s1",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  });
  afterEach(cleanup);

  test("shows a built-in panel under a header titled with the panel and session", () => {
    render(<MobileTerminalPanelScreen section="notes" sessionId="s1" />);
    expect(screen.getByText("notes-panel")).toBeTruthy();
    expect(screen.getByText("terminal.rightPanel.sections.notes")).toBeTruthy();
    expect(screen.getByText("web-01")).toBeTruthy();
  });

  test("leaves the page once History types a command into the session", () => {
    const pop = vi.fn();
    useMobileNavStore.setState({ pop });
    render(<MobileTerminalPanelScreen section="history" sessionId="s1" />);
    screen.getByText("history-panel").click();
    expect(pop).toHaveBeenCalled();
  });

  test("a plugin panel without a mobile screen shows its desktop component", () => {
    usePluginStore.setState({ rightPanelSections: new Map([["acme:widget", section("acme:widget")]]) });
    render(<MobileTerminalPanelScreen section="plugin:acme:widget" sessionId="s1" />);
    expect(screen.getByText("desktop-widget")).toBeTruthy();
  });

  test("a plugin's mobile screen with the section's id replaces the desktop component", () => {
    usePluginStore.setState({
      rightPanelSections: new Map([["acme:widget", section("acme:widget")]]),
      mobileScreens: new Map([["acme:widget", {
        id: "acme:widget",
        kind: "widget",
        render: ({ sessionId }) => <div>mobile-widget {sessionId}</div>,
      }]]),
    });
    render(<MobileTerminalPanelScreen section="plugin:acme:widget" sessionId="s1" />);
    expect(screen.getByText("mobile-widget s1")).toBeTruthy();
    expect(screen.queryByText("desktop-widget")).toBeNull();
  });
});
