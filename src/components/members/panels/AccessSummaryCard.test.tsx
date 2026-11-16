import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import type { PreviewResponse } from "@/services/permissionPreview";
import type { TeamMember } from "@/stores/teamStore";
import { PERM_BITS } from "@/services/permissions";
import { makeMember } from "@/test/team";

const h = vi.hoisted(() => ({ previewPermissions: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o?.hosts !== undefined ? `counts:${o.hosts}` : k) }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/services/permissionPreview", () => ({ previewPermissions: (...a: unknown[]) => h.previewPermissions(...a) }));
vi.mock("@/components/preview/useViewAsEntry", () => ({
  useViewAsEntry: () => ({ enabled: true, reason: null, reasonText: null, enter: vi.fn() }),
}));
vi.mock("@/components/shared/BusinessLockBanner", () => ({ UpgradeAction: () => null }));

import { AccessSummaryCard } from "./AccessSummaryCard";
import { useTeamObjectAccessStore } from "@/stores/teamObjectAccessStore";

const response = (hosts: number): PreviewResponse => ({
  locked: false, draft: null, affected: null,
  current: {
    team_bits: 0, rule_sets: {}, holds_vault_key_gate: false,
    objects: Object.fromEntries(Array.from({ length: hosts }, (_, i) => [`c${i}`, { mask: PERM_BITS.VIEW, rule_set_id: null }])),
  },
});

afterEach(() => { cleanup(); useTeamObjectAccessStore.getState().clearAll(); });

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

test("a_stale_response_is_ignored_after_switching_member", async () => {
  useTeamObjectAccessStore.getState().replaceTeam("t1", Object.fromEntries(
    ["c0", "c1", "c2"].map((id) => [id, { type: "connection", ruleSetId: null, myPermissions: 0, parentId: null, deleted: false }]),
  ), true);
  const first = deferred<PreviewResponse>();
  const second = deferred<PreviewResponse>();
  h.previewPermissions.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const a: TeamMember = makeMember("a", []);
  const b: TeamMember = makeMember("b", []);
  const view = render(<AccessSummaryCard teamId="t1" member={a} />);
  view.rerender(<AccessSummaryCard teamId="t1" member={b} />);
  await act(async () => { second.resolve(response(2)); });
  await act(async () => { first.resolve(response(3)); });
  expect(screen.getByTestId("access-summary-card").textContent).toContain("counts:2");
});
