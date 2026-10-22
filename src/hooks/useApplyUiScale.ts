import { useEffect } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { clampUiScale, useUIStore } from "@/stores/uiStore";
import { getPlatform } from "@/utils/platform";

const ROOT_SELECTOR = "#root";

/** Scale everything under #root with a transform, the fallback where the webview cannot zoom. */
function applyCssScale(scale: number) {
  document.documentElement.style.setProperty("--t-ui-scale", String(scale));
  const rootEl = document.querySelector(ROOT_SELECTOR) as HTMLElement | null;
  if (!rootEl) return;
  rootEl.style.transform = scale === 1 ? "" : `scale(${scale})`;
  rootEl.style.transformOrigin = "top left";
  rootEl.style.width = `${100 / scale}%`;
  rootEl.style.height = `${100 / scale}%`;
}

let generation = 0;

/** Zoom the webview itself where it can: it lays out and rasterizes text at the
 *  new size. A transform only resamples what was drawn at 100%, which leaves
 *  glyph edges soft and puts xterm's canvas between device pixels. Android's
 *  webview has no zoom API (wry no-ops there), so it keeps the transform. */
export async function applyUiScaleToDom(scale: number): Promise<void> {
  const clamped = clampUiScale(scale);
  const current = ++generation;
  let zoomed = false;
  if ((await getPlatform()) !== "android") {
    try {
      await getCurrentWebview().setZoom(clamped);
      zoomed = true;
    } catch {
      // Not in Tauri, or the zoom permission is missing.
    }
  }
  if (current !== generation) return;
  applyCssScale(zoomed ? 1 : clamped);
  useUIStore.getState().setWebviewZoom(zoomed ? clamped : 1);
}

export function useApplyUiScale() {
  const uiScale = useUIStore((s) => s.uiScale);

  useEffect(() => {
    void applyUiScaleToDom(uiScale);
  }, [uiScale]);
}
