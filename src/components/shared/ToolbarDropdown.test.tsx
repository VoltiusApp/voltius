// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ToolbarDropdown } from "./ToolbarDropdown";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
afterEach(cleanup);

test("renders action items with a submenu row and keeps rows from shrinking", () => {
  const onImport = vi.fn();
  render(
    <ToolbarDropdown
      icon="lucide:arrow-up-down"
      label="Import/Export"
      onAction={() => {}}
      items={[
        { label: "Import…", onClick: onImport },
        { separator: true },
        { label: "Import from", children: [{ label: "OpenSSH", onClick: () => {} }] },
      ]}
    />,
  );
  const buttons = screen.getAllByRole("button");
  fireEvent.click(buttons[buttons.length - 1]);
  expect(screen.getByText("Import from")).toBeTruthy();
  fireEvent.click(screen.getByText("Import…"));
  expect(onImport).toHaveBeenCalled();
});

test("a submenu row click runs and closes the menu", () => {
  const onOpenSsh = vi.fn();
  render(
    <ToolbarDropdown
      icon="lucide:arrow-up-down"
      label="Import/Export"
      onAction={() => {}}
      items={[{ label: "Import from", children: [{ label: "OpenSSH", onClick: onOpenSsh }] }]}
    />,
  );
  const buttons = screen.getAllByRole("button");
  fireEvent.click(buttons[buttons.length - 1]);
  fireEvent.mouseEnter(screen.getByText("Import from"));
  const child = screen.getByText("OpenSSH");
  fireEvent.mouseDown(child);
  fireEvent.click(child);
  expect(onOpenSsh).toHaveBeenCalled();
  expect(screen.queryByText("Import from")).toBeNull();
});

test("options rows cannot shrink", async () => {
  const { DropdownMenuItem } = await import("./DropdownMenuItem");
  render(<DropdownMenuItem label="Row" onClick={() => {}} />);
  expect(screen.getByRole("button").className).toContain("shrink-0");
});
