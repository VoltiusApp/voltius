import { expect } from "vitest";
import { act } from "@testing-library/react";
import { usePreviewStore } from "@/stores/previewStore";
import type { PreviewTarget } from "@/services/previewGuard";

export const PREVIEW_SESSION = { teamId: "team-1", vaultId: "team-1", subject: { type: "member" as const, user_id: "bob" } };

export const startPreview = () => usePreviewStore.setState({ session: PREVIEW_SESSION, side: null });
export const stopPreview = () => usePreviewStore.setState({ session: null, side: null, result: null });

/** Gives the preview a result that explains `ids`, so a refusal on one of them can open Why. */
export const explainable = (...ids: string[]) => usePreviewStore.setState({
  result: {
    locked: false, draft: null, affected: null,
    current: {
      team_bits: 0, rule_sets: {}, holds_vault_key_gate: true,
      objects: Object.fromEntries(ids.map((id) => [id, { mask: 0, rule_set_id: null }])),
    },
  },
});

export const callProp = (props: Record<string, unknown>, name: string, ...args: unknown[]) => () =>
  (props[name] as (...a: unknown[]) => unknown)(...args);

/** Each action, run while previewing, must open Why for its target (undefined: no Why, so a toast). */
export async function expectEachRefused(actions: [string, () => unknown, PreviewTarget | undefined][]) {
  explainable(...actions.flatMap(([, , target]) => (target ? [target.objectId] : [])));
  for (const [name, run, target] of actions) {
    usePreviewStore.setState({ side: null });
    await act(async () => { await run(); });
    expect(usePreviewStore.getState().side, name).toEqual(target ? { kind: "why", ...target } : null);
  }
}
