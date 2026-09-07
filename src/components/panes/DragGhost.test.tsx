import { test, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { useDragStore } from "@/stores/dragStore";
import { useSessionStore } from "@/stores/sessionStore";
import { DragGhost } from "./DragGhost";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/hooks/useAllConnections", () => ({ useAllConnections: () => [] }));

afterEach(cleanup);

test("the drag ghost carries the name the tab was given, not the connection", () => {
  useSessionStore.setState({
    sessions: [{ id: "s1", connectionId: "c1", connectionName: "web-01", title: "deploy", status: "connected", type: "local" }],
    activeSessionId: "s1",
  });
  useDragStore.setState({ isDragging: true, sessionId: "s1", currentX: 0, currentY: 0, dropTarget: null });

  render(<DragGhost />);

  expect(screen.getByText("deploy")).toBeTruthy();
});
