import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import MobileFab from "./MobileFab";
import { useNotificationStore } from "@/stores/notificationStore";

afterEach(cleanup);

describe("MobileFab", () => {
  test("fab renders data-mobile-fab extended/collapsed and calls onTap", () => {
    const onTap = vi.fn();
    const { rerender } = render(<MobileFab attr="mobile-add" icon="lucide:plus" label="New" extended onTap={onTap} />);
    const btn = screen.getByRole("button", { name: "New" });
    expect(btn.getAttribute("data-mobile-fab")).toBe("extended");
    expect(btn.hasAttribute("data-mobile-add")).toBe(true);
    expect(btn.hasAttribute("data-snackbar-avoid")).toBe(true);
    fireEvent.click(btn);
    expect(onTap).toHaveBeenCalledTimes(1);
    rerender(<MobileFab attr="mobile-add" icon="lucide:plus" label="New" extended={false} onTap={onTap} />);
    expect(btn.getAttribute("data-mobile-fab")).toBe("collapsed");
  });

  test("disabled fab explains its reason on tap and does not call onTap", () => {
    useNotificationStore.setState({ toasts: [] });
    const onTap = vi.fn();
    render(<MobileFab attr="mobile-add" icon="lucide:plus" label="New" extended onTap={onTap} disabledReason="Not allowed" />);
    const btn = screen.getByRole("button", { name: "New" });
    expect(btn.getAttribute("title")).toBe("Not allowed");
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(btn);
    expect(onTap).not.toHaveBeenCalled();
    expect(useNotificationStore.getState().toasts.map((x) => x.message)).toEqual(["Not allowed"]);
  });
});
