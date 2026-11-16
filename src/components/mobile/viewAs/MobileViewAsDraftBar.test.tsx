import { test, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { usePreviewStore } from "@/stores/previewStore";
import { startPreview, stopPreview } from "@/test/preview";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

import MobileViewAsDraftBar from "./MobileViewAsDraftBar";

const bar = () => document.querySelector<HTMLElement>("[data-mobile-view-as-draft]");

afterEach(() => {
  cleanup();
  stopPreview();
  usePreviewStore.setState({ draft: null });
});

test("draft_bar_hidden_without_a_draft", () => {
  startPreview();
  render(<MobileViewAsDraftBar />);
  expect(bar()).toBeNull();
});

test("draft_bar_is_a_56px_snackbar_anchor_with_touch_buttons", () => {
  startPreview();
  usePreviewStore.setState({ draft: { permissions: 1 } });
  render(<MobileViewAsDraftBar />);
  expect(bar()!.hasAttribute("data-snackbar-anchor")).toBe(true);
  expect(bar()!.style.height).toBe("56px");
  const buttons = bar()!.querySelectorAll("button");
  expect(buttons.length).toBe(2);
  buttons.forEach((b) => expect(b.className).toContain("min-h-12"));
});

test("draft_bar_pads_the_safe_area_when_it_is_the_bottom_edge", () => {
  startPreview();
  usePreviewStore.setState({ draft: { permissions: 1 } });
  render(<MobileViewAsDraftBar safeBottom />);
  expect(bar()!.style.paddingBottom).toBe("var(--vt-safe-bottom)");
});
