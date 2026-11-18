import type { MobileScreen as NavScreen } from "@/stores/mobileNavCore";

export interface ResolvedMobilePanel {
  /** The `kind` a plugin registered its mobile screen under (registerMobileScreen). */
  screenKind: string;
  props: Record<string, unknown>;
}

/**
 * Maps a "panel-*" nav-stack entry to the plugin-registered screen kind
 * MobileShell should look up, plus the props to pass it. This is the single
 * place that translates nav-stack kinds ("panel-docker-logs") to registered
 * screen kinds ("docker-logs"); runtime.ts's `toMobileNavScreen` does the
 * reverse translation for `pushMobileScreen`. Both switches are exhaustive
 * over their own source union, but nothing ties the two conventions together
 * automatically — see runtime.mobileScreen.test.ts's round-trip test, which
 * feeds this function's output straight from `toMobileNavScreen`'s.
 */
export function resolvePanelScreen(top: NavScreen | undefined): ResolvedMobilePanel | null {
  if (!top) return null;
  switch (top.kind) {
    case "panel-docker-logs":
      return {
        screenKind: "docker-logs",
        props: { sessionId: top.sessionId, containerId: top.containerId, containerName: top.containerName },
      };
    default:
      return null;
  }
}
