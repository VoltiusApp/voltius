import { useMemo } from "react";
import { useUIContributionStore } from "@/stores/uiContributionStore";
import type { ContributedAction, UISlot } from "@/plugins/api";

/**
 * Returns all actions contributed by plugins to the given slot.
 * Pass `ctx` when the slot expects a context object (e.g. a Connection or SshKey).
 * For context-free slots (bgContextMenu, settings.vaults, etc.) omit ctx.
 */
export function useUIContributions(slot: UISlot, ctx?: unknown): ContributedAction[] {
  const contributions = useUIContributionStore((s) => s.contributions);
  return useMemo(() => {
    const suffix = `::${slot}`;
    const result: ContributedAction[] = [];
    for (const [key, fn] of contributions) {
      if (!key.endsWith(suffix)) continue;
      for (const action of fn(ctx)) {
        if (action.when) {
          try {
            if (!action.when(ctx)) continue;
          } catch {
            continue;
          }
        }
        result.push(action);
      }
    }
    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contributions, slot, (ctx as any)?.id ?? ctx]);
}
