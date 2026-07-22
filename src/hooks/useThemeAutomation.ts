import { useEffect } from "react";
import { useThemeStore } from "@/stores/themeStore";
import { resolveThemePhase, nextTransition } from "@/services/themeAutomation";
import { getSystemPrefersDark, subscribeSystemAppearance } from "@/services/systemAppearance";

export function useThemeAutomation(): void {
  const mode = useThemeStore((s) => s.mode);
  const scheduleLightStart = useThemeStore((s) => s.scheduleLightStart);
  const scheduleDarkStart = useThemeStore((s) => s.scheduleDarkStart);
  const location = useThemeStore((s) => s.location);

  useEffect(() => {
    if (mode === "manual") return;

    let timer: ReturnType<typeof setTimeout> | undefined;

    const evaluate = () => {
      const cfg = useThemeStore.getState().getAutomationConfig();
      const now = new Date();
      const phase = resolveThemePhase(cfg, now, getSystemPrefersDark());
      useThemeStore.getState().setResolvedPhase(phase);

      if (timer) clearTimeout(timer);
      const next = nextTransition(cfg, now, getSystemPrefersDark());
      if (next) {
        // Cap the delay so a far-future boundary still re-checks (clock drift, DST).
        const delay = Math.min(Math.max(next.getTime() - now.getTime(), 1000), 6 * 60 * 60 * 1000);
        timer = setTimeout(evaluate, delay);
      }
    };

    evaluate();
    const unsubSystem = subscribeSystemAppearance(evaluate);
    const onFocus = () => evaluate();
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      if (timer) clearTimeout(timer);
      unsubSystem();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [mode, scheduleLightStart, scheduleDarkStart, location]);
}
