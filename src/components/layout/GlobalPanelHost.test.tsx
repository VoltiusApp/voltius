import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import GlobalPanelHost from "./GlobalPanelHost";
import { usePluginStore } from "@/stores/pluginStore";
import { useUIStore } from "@/stores/uiStore";

const Drawer: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) =>
  open ? <button onClick={onClose}>close-drawer</button> : null;

beforeEach(() => {
  usePluginStore.setState({ globalPanels: new Map([["ai:drawer", { id: "ai:drawer", component: Drawer }]]) });
  useUIStore.setState({ globalPanelOpen: {} });
});
afterEach(cleanup);

describe("GlobalPanelHost", () => {
  test("does not render a closed panel", () => {
    render(<GlobalPanelHost />);
    expect(screen.queryByText("close-drawer")).toBeNull();
  });

  test("renders an open panel and wires onClose to setGlobalPanelOpen(false)", () => {
    useUIStore.setState({ globalPanelOpen: { "ai:drawer": true } });
    render(<GlobalPanelHost />);
    fireEvent.click(screen.getByText("close-drawer"));
    expect(useUIStore.getState().globalPanelOpen["ai:drawer"]).toBe(false);
  });
});
