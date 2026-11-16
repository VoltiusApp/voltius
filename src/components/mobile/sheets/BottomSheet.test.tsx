// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { cleanup, render } from "@testing-library/react";
import BottomSheet from "./BottomSheet";

afterEach(cleanup);

test("bottom_sheet_footer_renders_outside_the_scroller", () => {
  render(<BottomSheet onClose={() => {}} footer={<div data-testid="foot" />}><div data-testid="body" /></BottomSheet>);
  const body = document.querySelector("[data-mobile-sheet-body]")!;
  const foot = document.querySelector("[data-testid=foot]")!;
  const panel = document.querySelector("[data-mobile-sheet-panel]")!;
  expect(body.contains(foot)).toBe(false);
  expect(foot.closest("[data-mobile-sheet-panel]")).toBe(panel);
  expect(body.contains(document.querySelector("[data-testid=body]"))).toBe(true);
});

test("bottom_sheet_without_footer_renders_none", () => {
  render(<BottomSheet onClose={() => {}}><div /></BottomSheet>);
  expect(document.querySelector("[data-mobile-sheet-footer]")).toBeNull();
});

test("untitled_sheet_collapses_its_header_to_the_drag_handle", () => {
  render(<BottomSheet onClose={() => {}}><div /></BottomSheet>);
  const handle = document.querySelector("[data-mobile-sheet-handle]")!;
  expect(handle.className).not.toContain("min-h-12");
  expect(handle.childElementCount).toBe(1);
});

test("titled_sheet_keeps_its_48px_title_row", () => {
  render(<BottomSheet onClose={() => {}} title="web-01"><div /></BottomSheet>);
  const handle = document.querySelector("[data-mobile-sheet-handle]")!;
  expect(handle.className).toContain("min-h-12");
  expect(handle.textContent).toBe("web-01");
});
