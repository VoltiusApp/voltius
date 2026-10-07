import { test, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/stores/connectionStore", () => {
  const state = { connections: [
    { id: "a", name: "A", host: "a", port: 22, username: "u" },
    { id: "b", name: "B", host: "b", port: 22, username: "u" },
  ] };
  return { useConnectionStore: (sel?: (s: unknown) => unknown) => (sel ? sel(state) : state) };
});
vi.mock("@/components/shared/ConnectionAvatar", () => ({ ConnectionAvatar: () => null }));
vi.mock("@/components/shared/HostPickerPanel", () => ({ HostPickerPanel: () => null }));

import JumpHostsPanel from "./JumpHostsPanel";

afterEach(cleanup);

const rows = [{ id: "j1", connection_id: "a" }, { id: "j2", connection_id: "b" }];

test("dragging the first row after the second swaps them", () => {
  const onChange = vi.fn();
  render(<JumpHostsPanel jumpHosts={rows} onChange={onChange} onBack={() => {}} />);
  const handles = screen.getAllByLabelText("connections.jumpHostsPanel.dragToReorderAriaLabel");
  fireEvent.mouseDown(handles[0]);
  fireEvent.mouseMove(screen.getByText("B").closest("[class*='rounded-lg']")!, { clientY: 10 });
  fireEvent.mouseUp(handles[0]);
  expect(onChange).toHaveBeenCalledWith([rows[1], rows[0]]);
});

test("remove drops the row", () => {
  const onChange = vi.fn();
  render(<JumpHostsPanel jumpHosts={rows} onChange={onChange} onBack={() => {}} />);
  fireEvent.click(screen.getAllByLabelText("connections.jumpHostsPanel.removeAriaLabel")[0]);
  expect(onChange).toHaveBeenCalledWith([rows[1]]);
});
