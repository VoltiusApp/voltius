import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Connection } from "@/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, string>) => (o?.from ? `${k}:${o.from}>${o.to}` : k) }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/services/vault", () => ({ getSecret: vi.fn() }));
vi.mock("@/services/credentials", () => ({ findConnection: () => undefined }));
vi.mock("@/components/shared/BaseCard", () => ({
  BaseCard: ({ children, contextMenuItems }: { children: React.ReactNode; contextMenuItems?: { label: string; onClick: () => void }[] }) => (
    <div>
      {children}
      {contextMenuItems?.map((i) => <button key={i.label} data-menu={i.label} onClick={i.onClick} />)}
    </div>
  ),
}));
vi.mock("@/components/shared/ConnectionAvatar", () => ({ ConnectionAvatar: () => null }));
vi.mock("@/components/shared/CardActionButton", () => ({
  CardActionButton: ({ title, disabled }: { title: string; disabled?: boolean }) => <button title={title} disabled={disabled} />,
  CardMenuButton: () => null,
  CardPinButton: () => null,
}));
vi.mock("@/components/shared/OverflowTagList", () => ({ OverflowTagList: () => null }));
vi.mock("@/components/shared/AvatarStack", () => ({ MiniAvatar: () => null }));
vi.mock("@/hooks/useConnectionPresence", () => ({ useConnectionPresence: () => null }));
vi.mock("@/hooks/useUIContributions", () => ({ useUIContributions: () => [] }));
vi.mock("@/hooks/useCanConnect", () => ({ useCanConnect: () => true }));
vi.mock("@/hooks/useConnectAsMenuItem", () => ({ useConnectAsMenuItem: () => undefined }));
vi.mock("@/hooks/useCredentialPlan", () => ({ useCredentialPlan: () => ({ plan: null }) }));
vi.mock("@/services/credentialScope", () => ({ effectiveUsername: () => "root" }));
vi.mock("@/hooks/useEffectivePinned", () => ({
  useEffectivePinned: () => false,
  useEffectivePinSource: () => "none",
  nextPersonalPinValue: () => true,
}));
vi.mock("@/stores/toggleSettingsStore", () => ({ useToggle: () => [false] }));
vi.mock("@/utils/connectionMenuItems", () => ({ buildConnectionMenuItems: ({ extras }: { extras: unknown[] }) => extras }));

const { default: HostCard } = await import("./HostCard");
const { PreviewContentScope } = await import("@/components/preview/PreviewScope");
const { usePreviewStore } = await import("@/stores/previewStore");
const { useConnectionStore } = await import("@/stores/connectionStore");
const { startPreview, stopPreview } = await import("@/test/preview");
const { PERM_BITS } = await import("@/services/permissions");

const conn = { id: "c1", name: "prod-db", host: "h1", port: 22, username: "root", tags: [], vault_id: "team-1" } as unknown as Connection;
const V = PERM_BITS.VIEW;

const previewOf = (current: number, draft?: number) => ({
  locked: false,
  current: { team_bits: 0, objects: { c1: { mask: current, rule_set_id: null } }, rule_sets: {}, holds_vault_key_gate: true },
  draft: draft === undefined ? null : { team_bits: 0, objects: { c1: { mask: draft, rule_set_id: null } }, rule_sets: {}, holds_vault_key_gate: true },
  affected: null,
});

function renderCard(layout: "grid" | "list", canEdit = true) {
  const noop = vi.fn();
  return render(
    <PreviewContentScope>
      <HostCard connection={conn} layout={layout} canEdit={canEdit} onConnect={noop} onEdit={noop} onDuplicate={noop} onDelete={noop} />
    </PreviewContentScope>,
  );
}

vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });

beforeEach(() => startPreview());
afterEach(() => {
  cleanup();
  stopPreview();
  usePreviewStore.setState({ result: null });
});

describe("HostCard while previewing", () => {
  test("grid_card_shows_draft_badge_in_top_row_only", () => {
    usePreviewStore.setState({ result: previewOf(V, V | PERM_BITS.CONNECT) });
    const { container } = renderCard("grid");
    const badge = screen.getByText("members.viewAs.draftBadge");
    const titleRow = screen.getByText("prod-db").parentElement as HTMLElement;
    expect(titleRow.contains(badge)).toBe(true);
    expect(container.textContent).not.toContain("members.viewAs.level");
    expect(container.textContent).not.toContain("members.viewAs.secrets");
    expect(container.textContent).not.toContain("members.viewAs.draftChange");
  });

  test("grid_card_without_change_adds_no_text", () => {
    usePreviewStore.setState({ result: previewOf(V | PERM_BITS.CONNECT) });
    const { container } = renderCard("grid");
    expect(container.textContent).not.toContain("members.viewAs");
  });

  test("list_row_shows_level_secrets_and_draft_text", () => {
    usePreviewStore.setState({ result: previewOf(V | PERM_BITS.CONNECT, V | PERM_BITS.CONNECT | PERM_BITS.EDIT_CONNECTIONS) });
    renderCard("list");
    expect(screen.getByText("members.viewAs.level.edit")).toBeTruthy();
    expect(screen.getByText("members.viewAs.secrets.no")).toBeTruthy();
    expect(screen.getByText("members.viewAs.draftChange:members.viewAs.level.connect>members.viewAs.level.edit")).toBeTruthy();
  });

  test("list_row_with_secrets_shows_yes_chip", () => {
    usePreviewStore.setState({ result: previewOf(V | PERM_BITS.CONNECT | PERM_BITS.VIEW_SECRETS) });
    renderCard("list");
    expect(screen.getByText("members.viewAs.secrets.yes")).toBeTruthy();
  });

  test("view_only_terminal_tile_is_greyed_and_labelled", () => {
    usePreviewStore.setState({ result: previewOf(V) });
    renderCard("grid");
    const tile = screen.getByTitle("members.viewAs.level.view") as HTMLButtonElement;
    expect(tile.disabled).toBe(true);
  });
});

describe("HostCard edit pencil", () => {
  test.each(["grid", "list"] as const)("pencil_is_disabled_not_hidden_without_edit (%s)", (layout) => {
    stopPreview();
    renderCard(layout, false);
    const pencil = screen.getByTitle("members.permissions.youCannotEdit") as HTMLButtonElement;
    expect(pencil.disabled).toBe(true);
  });

  test("pencil_reason_names_the_member_only_inside_a_preview", () => {
    usePreviewStore.setState({ result: previewOf(V) });
    renderCard("grid", false);
    expect((screen.getByTitle("members.viewAs.cannotEdit") as HTMLButtonElement).disabled).toBe(true);
  });

  test.each(["grid", "list"] as const)("pencil_is_enabled_with_edit (%s)", (layout) => {
    stopPreview();
    renderCard(layout, true);
    expect((screen.getByTitle("common.action.edit") as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("HostCard context menu while previewing", () => {
  test("pin_click_opens_why_and_never_reaches_the_store", () => {
    const pinConnection = vi.fn(() => Promise.resolve());
    useConnectionStore.setState({ pinConnection } as never);
    usePreviewStore.setState({ result: previewOf(V | PERM_BITS.CONNECT) });
    const { container } = renderCard("grid");
    fireEvent.click(container.querySelector('[data-menu="hosts.card.pin"]') as HTMLElement);
    expect(usePreviewStore.getState().side).toEqual({ kind: "why", type: "connection", objectId: "c1" });
    expect(pinConnection).not.toHaveBeenCalled();
  });
});
