import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import MobileSelectionBar from "./MobileSelectionBar";
import { useNotificationStore } from "@/stores/notificationStore";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string, o?: { count?: number }) => (o?.count !== undefined ? `${k}:${o.count}` : k) }) }));

afterEach(cleanup);

function setup(over: Partial<React.ComponentProps<typeof MobileSelectionBar>> = {}) {
  const props = {
    attr: "x-selection-bar", count: 3, allSelected: false, onClose: vi.fn(), onToggleAll: vi.fn(),
    actions: [], ...over,
  };
  const view = render(<MobileSelectionBar {...props} />);
  return { ...props, ...view };
}

describe("MobileSelectionBar", () => {
  test("shows the count and the bar attribute", () => {
    const { container } = setup();
    expect(screen.getByText("mobile.selection.selectedCount:3")).toBeTruthy();
    expect(container.querySelector("[data-x-selection-bar]")).not.toBeNull();
  });

  test("close and toggle-all fire, toggle-all icon follows allSelected", () => {
    const { onClose, onToggleAll, container, rerender } = setup();
    fireEvent.click(screen.getByRole("button", { name: "mobile.selection.clearSelectionAriaLabel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    const all = screen.getByRole("button", { name: "mobile.selection.selectAll" });
    expect(all.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(all);
    expect(onToggleAll).toHaveBeenCalledTimes(1);
    rerender(<MobileSelectionBar attr="x-selection-bar" count={3} allSelected onClose={onClose} onToggleAll={onToggleAll} actions={[]} />);
    expect(screen.getByRole("button", { name: "mobile.selection.selectAll" }).getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector("[data-x-sel-all]")).not.toBeNull();
  });

  test("danger action is styled and an enabled action fires", () => {
    const onTap = vi.fn();
    setup({ actions: [{ attr: "data-x-del", icon: "lucide:trash-2", label: "Delete", onTap, danger: true }] });
    const btn = screen.getByRole("button", { name: "Delete" });
    expect(btn.getAttribute("style")).toContain("--t-status-error");
    fireEvent.click(btn);
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  test("disabled action explains its reason on tap and does not fire", () => {
    useNotificationStore.setState({ toasts: [] });
    const onTap = vi.fn();
    const action = { attr: "data-x-del", icon: "lucide:trash-2", label: "Delete", onTap, disabledReason: "Read only" };
    setup({ actions: [action], more: [{ ...action, attr: "data-x-more-del" }] });
    const btn = screen.getByRole("button", { name: "Read only" });
    expect(btn.getAttribute("title")).toBe("Read only");
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(btn);
    fireEvent.click(screen.getByRole("button", { name: "mobile.selection.moreActions" }));
    const sheetRow = document.querySelector<HTMLElement>("[data-x-more-del]")!;
    expect(sheetRow.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(sheetRow);
    expect(onTap).not.toHaveBeenCalled();
    expect(useNotificationStore.getState().toasts.map((x) => x.message)).toEqual(["Read only", "Read only"]);
  });

  test("more actions open a sheet whose rows fire and close it", () => {
    const onTap = vi.fn();
    setup({ more: [{ attr: "data-x-rename", icon: "lucide:pencil", label: "Rename", onTap }] });
    fireEvent.click(screen.getByRole("button", { name: "mobile.selection.moreActions" }));
    fireEvent.click(screen.getByText("Rename"));
    expect(onTap).toHaveBeenCalledTimes(1);
  });
});
