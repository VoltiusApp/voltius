import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act, waitFor } from "@testing-library/react";
import { usePreviewStore } from "@/stores/previewStore";
import { runBack } from "@/hooks/useAndroidBack";

vi.mock("@/components/preview/WhyPanel", () => ({ WhyPanel: () => <div data-testid="why-panel" /> }));

import MobileViewAsSheets from "./MobileViewAsSheets";

const showWhy = () => usePreviewStore.setState({ side: { kind: "why", type: "connection", objectId: "c1" } });

afterEach(() => {
  cleanup();
  usePreviewStore.setState({ side: null });
});

test("why_side_opens_the_sheet_with_why_panel", () => {
  showWhy();
  render(<MobileViewAsSheets />);
  const sheet = document.querySelector("[data-mobile-sheet]")!;
  expect(sheet.querySelector("[data-vt-hit-scope] [data-testid=why-panel]")).not.toBeNull();
});

test("closing_the_sheet_closes_the_side", async () => {
  showWhy();
  render(<MobileViewAsSheets />);
  fireScrimClick();
  await waitFor(() => expect(usePreviewStore.getState().side).toBeNull());
});

test("android_back_closes_the_why_sheet_first", async () => {
  showWhy();
  render(<MobileViewAsSheets />);
  let handled = false;
  act(() => { handled = runBack(); });
  expect(handled).toBe(true);
  await waitFor(() => expect(usePreviewStore.getState().side).toBeNull());
});

test("access_side_renders_nothing_yet", () => {
  usePreviewStore.setState({ side: { kind: "access" } });
  render(<MobileViewAsSheets />);
  expect(document.querySelector("[data-mobile-sheet]")).toBeNull();
  expect(screen.queryByTestId("why-panel")).toBeNull();
});

function fireScrimClick() {
  act(() => { (document.querySelector("[data-mobile-sheet-scrim]") as HTMLElement).click(); });
}
