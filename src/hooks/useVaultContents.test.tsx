import { afterEach, beforeEach, expect, test } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { PreviewContentScope } from "@/hooks/previewScope";
import { useVaultContents } from "@/hooks/useVaultContents";
import { useConnectionStore } from "@/stores/connectionStore";
import { useTeamStore } from "@/stores/teamStore";
import { usePreviewStore } from "@/stores/previewStore";
import { PERM_BITS } from "@/services/permissions";
import { makeTeam } from "@/test/team";
import { startPreview, stopPreview } from "@/test/preview";

const conn = (id: string) => ({ id, name: id, host: "h", port: 22, username: "root", tags: [], vault_id: "team-1" });
const side = (gate: boolean) => ({
  team_bits: 0, rule_sets: {}, holds_vault_key_gate: gate,
  objects: { c1: { mask: PERM_BITS.VIEW, rule_set_id: null }, c2: { mask: 0, rule_set_id: null } },
});
const hosts = (wrapper?: ({ children }: { children: ReactNode }) => ReactNode) =>
  renderHook(() => useVaultContents("team-1"), { wrapper }).result.current.find((c) => c.key === "connections")!.count;
const inContent = ({ children }: { children: ReactNode }) => <PreviewContentScope>{children}</PreviewContentScope>;

beforeEach(() => {
  useTeamStore.setState({ teams: [makeTeam("team-1")] });
  useConnectionStore.setState({ connections: [], teamConnections: { "team-1": [conn("c1"), conn("c2"), conn("c3")] } } as never);
  startPreview();
  usePreviewStore.setState({ result: { locked: false, current: side(true), draft: null, affected: null } });
});
afterEach(stopPreview);

test("preview_counts_only_what_the_shown_side_can_view", () => {
  expect(hosts(inContent)).toBe(2);
});

test("a_keyless_shown_side_counts_no_preview_object", () => {
  usePreviewStore.setState({ result: { locked: false, current: side(false), draft: null, affected: null } });
  expect(hosts(inContent)).toBe(1);
});

test("counts_are_whole_outside_the_preview_content_or_without_a_preview", () => {
  expect(hosts()).toBe(3);
  stopPreview();
  expect(hosts(inContent)).toBe(3);
});
