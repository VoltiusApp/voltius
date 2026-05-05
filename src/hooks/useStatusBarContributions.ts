import { useMemo } from "react";
import { useUIContributionStore } from "@/stores/uiContributionStore";
import type { ReactNode } from "react";
import type { TerminalStatusBarContributionContext, UIStatusBarSlot } from "@/plugins/api";

export interface StatusBarContributionNode {
  key: string;
  node: ReactNode;
}

/** Returns React nodes contributed by plugins to a terminal status bar slot. */
export function useStatusBarContributions(
  slot: UIStatusBarSlot,
  ctx: TerminalStatusBarContributionContext,
): StatusBarContributionNode[] {
  const contributions = useUIContributionStore((s) => s.statusBarContributions);
  return useMemo(() => {
    const suffix = `::${slot}`;
    const result: StatusBarContributionNode[] = [];
    for (const [key, fn] of contributions) {
      if (!key.endsWith(suffix)) continue;
      try {
        const node = fn(ctx);
        if (node !== null && node !== undefined && node !== false) result.push({ key, node });
      } catch {
        continue;
      }
    }
    return result;
  }, [contributions, slot, ctx]);
}
