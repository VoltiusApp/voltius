import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { PreviewContentScope } from "./PreviewScope";
import { PreviewSubtitle } from "./PreviewHint";
import { usePreviewStore } from "@/stores/previewStore";
import { PERM_BITS } from "@/services/permissions";
import { startPreview, stopPreview } from "@/test/preview";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, string>) => (o?.from ? `${k}:${o.from}>${o.to}` : k) }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const side = (mask: number) => ({ team_bits: 0, objects: { c1: { mask, rule_set_id: null } }, rule_sets: {}, holds_vault_key_gate: true });
const preview = (current: number, draft?: number) =>
  usePreviewStore.setState({ result: { locked: false, current: side(current), draft: draft === undefined ? null : side(draft), affected: null } });

const subtitle = () => render(
  <PreviewContentScope><PreviewSubtitle type="connection" id="c1"><span>plain</span></PreviewSubtitle></PreviewContentScope>,
).container;

beforeEach(startPreview);
afterEach(() => {
  cleanup();
  stopPreview();
});

test("row_subtitle_shows_a_draft_as_one_target_level_chip", () => {
  preview(PERM_BITS.VIEW, PERM_BITS.VIEW | PERM_BITS.CONNECT);
  const chips = [...subtitle().querySelectorAll("span span")].map((s) => s.textContent);
  expect(chips).toEqual(["→ members.viewAs.level.connect", "members.viewAs.secrets.no"]);
  const draft = subtitle().querySelector("[title]")!;
  expect(draft.getAttribute("title")).toBe("members.viewAs.draftChange:members.viewAs.level.view>members.viewAs.level.connect");
  expect(draft.className).toContain("text-(--t-accent)");
});

test("row_subtitle_without_a_draft_shows_the_level_chip", () => {
  preview(PERM_BITS.VIEW);
  const chips = [...subtitle().querySelectorAll("span span")].map((s) => s.textContent);
  expect(chips).toEqual(["members.viewAs.level.view", "members.viewAs.secrets.no"]);
});

test("row_subtitle_outside_a_preview_shows_its_children", () => {
  stopPreview();
  expect(subtitle().textContent).toBe("plain");
});
