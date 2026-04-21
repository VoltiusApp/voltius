import { useEffect } from "react";
import { clampUiScale, useUIStore } from "@/stores/uiStore";

const ROOT_SELECTOR = "#root";

export function applyUiScaleToDom(scale: number) {
  const clamped = clampUiScale(scale);
  const root = document.documentElement;
  root.style.setProperty("--t-ui-scale", String(clamped));

  // Use one scaling strategy across platforms; CSS zoom is inconsistent between engines.
  (document.body.style as CSSStyleDeclaration & { zoom?: string }).zoom = "1";

  const rootEl = document.querySelector(ROOT_SELECTOR) as HTMLElement | null;
  if (!rootEl) return;
  rootEl.style.transform = `scale(${clamped})`;
  rootEl.style.transformOrigin = "top left";
  rootEl.style.width = `${100 / clamped}%`;
  rootEl.style.height = `${100 / clamped}%`;
}

export function useApplyUiScale() {
  const uiScale = useUIStore((s) => s.uiScale);

  useEffect(() => {
    applyUiScaleToDom(uiScale);
  }, [uiScale]);
}
