import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import MobileListRow from "./MobileListRow";

const base = { attr: "mobile-thing", id: "a1", leading: <i />, title: "Alice", onTap: () => {} };

afterEach(cleanup);

describe("MobileListRow", () => {
  test("tap calls onTap, long-press calls onLong", () => {
    const onTap = vi.fn();
    const onLong = vi.fn();
    const { container } = render(<MobileListRow {...base} onTap={onTap} onLong={onLong} />);
    expect(container.querySelector("[data-mobile-thing='a1']")).not.toBeNull();
    const btn = screen.getByText("Alice").closest("button")!;
    fireEvent.click(btn);
    expect(onTap).toHaveBeenCalledTimes(1);
    fireEvent.contextMenu(btn);
    expect(onLong).toHaveBeenCalledTimes(1);
  });

  test("renders the actions button with the row attr", () => {
    const onActions = vi.fn();
    const { container } = render(<MobileListRow {...base} actionsLabel="More" onActions={onActions} />);
    fireEvent.click(container.querySelector("[data-mobile-thing-actions='a1']")!);
    expect(onActions).toHaveBeenCalledTimes(1);
  });

  test("actions label uses name when title is not a string", () => {
    const { container } = render(<MobileListRow {...base} title={<b>Alice</b>} name="Alice" actionsLabel="More" onActions={() => {}} />);
    expect(container.querySelector("[data-mobile-thing-actions='a1']")!.getAttribute("aria-label")).toBe("More: Alice");
  });

  test("selecting shows a checkbox reflecting selected", () => {
    const { rerender } = render(<MobileListRow {...base} selecting selected />);
    expect(screen.getByRole("checkbox", { checked: true })).toBeTruthy();
    rerender(<MobileListRow {...base} selecting selected={false} />);
    expect(screen.getByRole("checkbox", { checked: false })).toBeTruthy();
  });

  test("a select-disabled row shows its reason and is aria-disabled", () => {
    const onTap = vi.fn();
    render(<MobileListRow {...base} onTap={onTap} selecting selectDisabledReason="Owner can't be removed" />);
    expect(screen.getByRole("checkbox").getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText("Owner can't be removed")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onTap).not.toHaveBeenCalled();
  });
});
