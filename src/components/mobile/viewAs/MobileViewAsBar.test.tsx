import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { usePreviewStore } from "@/stores/previewStore";
import { useTeamStore } from "@/stores/teamStore";
import { makeMember } from "@/test/team";
import { startPreview, stopPreview } from "@/test/preview";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: ({ icon }: { icon: string }) => <i data-icon={icon} /> }));

import MobileViewAsBar from "./MobileViewAsBar";

beforeEach(() => {
  useTeamStore.setState({ membersByTeam: { "team-1": [makeMember("bob", [], { member_name: "Bob" })] }, rolesByTeam: {} });
});
afterEach(() => {
  cleanup();
  stopPreview();
  usePreviewStore.setState({ status: "idle", error: null, draft: null });
});

test("bar_shows_subject_and_status_and_close_exits", () => {
  startPreview();
  usePreviewStore.setState({ status: "loading" });
  render(<MobileViewAsBar />);
  const bar = document.querySelector("[data-mobile-view-as-bar]")!;
  expect(bar.textContent).toContain("members.viewAs.viewingAs");
  expect(screen.getByTestId("view-as-loading")).toBeTruthy();
  const close = document.querySelector<HTMLElement>("[data-view-as-close]")!;
  expect(close.getAttribute("aria-label")).toBe("members.viewAs.exit");
  fireEvent.click(close);
  expect(usePreviewStore.getState().session).toBeNull();
});

test("bar_not_rendered_outside_a_preview", () => {
  render(<MobileViewAsBar />);
  expect(document.querySelector("[data-mobile-view-as-bar]")).toBeNull();
});

test("bar_access_button_shows_access", () => {
  startPreview();
  render(<MobileViewAsBar />);
  const btn = document.querySelector<HTMLElement>("[data-view-as-access]")!;
  expect(btn.getAttribute("aria-label")).toBe("mobile.viewAs.editAccess");
  expect(btn.querySelector("[data-icon='lucide:sliders-horizontal']")).not.toBeNull();
  fireEvent.click(btn);
  expect(usePreviewStore.getState().side).toEqual({ kind: "access" });
});
