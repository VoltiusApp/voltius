import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, o?: { name?: string }) => (o?.name ? `${k}:${o.name}` : k) }),
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));

const { GhostCard, GhostOr } = await import("./GhostCard");
const { PreviewContentScope } = await import("./PreviewScope");
const { usePreviewStore } = await import("@/stores/previewStore");
const { useTeamStore } = await import("@/stores/teamStore");
const { PREVIEW_SESSION, startPreview, stopPreview } = await import("@/test/preview");
const { PERM_BITS } = await import("@/services/permissions");
const { makeMember } = await import("@/test/team");

const preview = (objects: Record<string, number>) => ({
  locked: false,
  current: {
    team_bits: 0,
    objects: Object.fromEntries(Object.entries(objects).map(([k, mask]) => [k, { mask, rule_set_id: null }])),
    rule_sets: {},
    holds_vault_key_gate: true,
  },
  draft: null,
  affected: null,
});

beforeEach(() => {
  useTeamStore.setState({ membersByTeam: { "team-1": [makeMember("bob", [], { handle: "Bob" })] }, rolesByTeam: {} });
  startPreview();
});
afterEach(() => {
  cleanup();
  stopPreview();
  usePreviewStore.setState({ result: null });
});

test("ghost_click_opens_why", () => {
  usePreviewStore.setState({ result: preview({ h1: 0 }) });
  const real = vi.fn();
  render(
    <PreviewContentScope>
      <GhostOr type="connection" id="h1" icon="lucide:server" name="prod-db" layout="grid">
        <button onClick={real}>real card</button>
      </GhostOr>
    </PreviewContentScope>,
  );
  expect(screen.queryByText("real card")).toBeNull();
  expect(screen.getByText("prod-db")).toBeTruthy();
  expect(screen.getByText(/members\.viewAs\.hiddenFrom/)).toBeTruthy();
  fireEvent.click(screen.getByText("prod-db"));
  expect(usePreviewStore.getState().side).toEqual({ kind: "why", type: "connection", objectId: "h1" });
  expect(real).not.toHaveBeenCalled();
});

test("renders the real card when the object is visible", () => {
  usePreviewStore.setState({ result: preview({ h1: PERM_BITS.VIEW }) });
  render(
    <PreviewContentScope>
      <GhostOr type="connection" id="h1" icon="lucide:server" name="prod-db" layout="list">
        <span>real card</span>
      </GhostOr>
    </PreviewContentScope>,
  );
  expect(screen.getByText("real card")).toBeTruthy();
});

test("a_member_without_the_vault_key_sees_a_ghost_even_where_rules_allow", () => {
  const keyless = preview({ h1: PERM_BITS.VIEW | PERM_BITS.CONNECT });
  usePreviewStore.setState({ result: { ...keyless, current: { ...keyless.current, holds_vault_key_gate: false } } });
  render(
    <PreviewContentScope>
      <GhostOr type="connection" id="h1" icon="lucide:server" name="prod-db" layout="list">
        <span>real card</span>
      </GhostOr>
    </PreviewContentScope>,
  );
  expect(screen.queryByText("real card")).toBeNull();
  expect(screen.getByText(/members\.viewAs\.hiddenFrom/)).toBeTruthy();
});

test("renders the real card outside a preview", () => {
  stopPreview();
  render(
    <GhostOr type="connection" id="h1" icon="lucide:server" name="prod-db" layout="list">
      <span>real card</span>
    </GhostOr>,
  );
  expect(screen.getByText("real card")).toBeTruthy();
});

test("GhostCard shares the dashed draft style with a dim border", () => {
  const { container } = render(<GhostCard layout="grid" icon="lucide:server" name="x" onClick={() => {}} />);
  const cls = (container.firstElementChild as HTMLElement).className;
  expect(cls).toContain("border-dashed");
  expect(cls).toContain("border-(--t-border)");
  expect(cls).toContain("opacity-[0.55]");
  expect(PREVIEW_SESSION.teamId).toBe("team-1");
});

test("row_layout_renders_a_72px_dashed_row_with_hidden_from", () => {
  usePreviewStore.setState({ result: preview({ h1: 0 }) });
  const { container } = render(
    <PreviewContentScope>
      <GhostOr type="connection" id="h1" icon="lucide:server" name="prod-db" layout="row">
        <span>real card</span>
      </GhostOr>
    </PreviewContentScope>,
  );
  const ghost = container.querySelector("[data-ghost-card]") as HTMLElement;
  expect(ghost.className).toContain("border-dashed");
  expect(ghost.className).toContain("h-[72px]");
  expect(ghost.className).toContain("px-4");
  expect(ghost.className).toContain("gap-4");
  expect(ghost.className).toContain("opacity-[0.55]");
  expect(ghost.querySelector("[style*='2.667rem']")).toBeTruthy();
  expect(screen.getByText("prod-db")).toBeTruthy();
  expect(screen.getByText(/members\.viewAs\.hiddenFrom/)).toBeTruthy();
});
