import i18n from "@/i18n";
import type { PluginAPI } from "@/plugins/api";
import { useUIStore } from "@/stores/uiStore";
import { useAgentStore } from "./agentStore";
import { DRAWER_PANEL_ID } from "../panelId";

const TOAST_DURATION_MS = 8000;

/**
 * Notify-only toast for an approval the user cannot see because the drawer is
 * closed. Deliberately offers no inline Approve: authorising a command from a
 * one-line toast that may have truncated it is the same failure shape as a
 * coarse grant, and there is no second line of defence behind it. The single
 * action opens the drawer, where the full card is.
 *
 * A toast cannot be recalled once shown (`notifications.toast` returns void),
 * so an approval registered while the drawer was OPEN never toasts later even
 * if the drawer closes — the decision is made at creation time. The persistent
 * signal for a still-pending approval is the TitleBar badge.
 */
export function installApprovalToasts(api: PluginAPI): () => void {
  const seen = new Set<string>();
  return useAgentStore.subscribe((state) => {
    const open = Boolean(useUIStore.getState().globalPanelOpen[DRAWER_PANEL_ID]);
    for (const p of state.pendingApprovals) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      if (open) continue;
      api.notifications.toast(i18n.t("aiAgent.toast.pending", { tool: p.tool }), {
        severity: "warning",
        duration: TOAST_DURATION_MS,
        action: {
          label: i18n.t("aiAgent.toast.openToReview"),
          onClick: () => useUIStore.getState().setGlobalPanelOpen(DRAWER_PANEL_ID, true),
        },
      });
    }
    // Notify-only, exactly like the approval toast: a checklist cannot be
    // meaningfully reviewed — let alone edited — in a one-line toast, and
    // approving one grants a whole batch of authority at once.
    const plan = state.pendingPlan;
    if (plan && !seen.has(plan.planId)) {
      seen.add(plan.planId);
      if (!open) {
        api.notifications.toast(
          i18n.t("aiAgent.toast.planPending", { count: plan.steps.length }),
          {
            severity: "warning",
            duration: TOAST_DURATION_MS,
            action: {
              label: i18n.t("aiAgent.toast.openToReview"),
              onClick: () => useUIStore.getState().setGlobalPanelOpen(DRAWER_PANEL_ID, true),
            },
          },
        );
      }
    }
    const live = new Set(state.pendingApprovals.map((p) => p.id));
    if (state.pendingPlan) live.add(state.pendingPlan.planId);
    for (const id of seen) if (!live.has(id)) seen.delete(id);
  });
}
