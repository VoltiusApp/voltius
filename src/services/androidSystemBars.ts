/**
 * Android status/navigation bar icon contrast, driven by the active Voltius theme (not the
 * phone's dark mode). `applyThemeToDom` calls `syncSystemBars` with the theme's base background
 * (the colour the bars sit on in MobileShell); we pick dark icons when that background is light
 * and push it to Rust `set_system_bars` → `SystemBars.kt`. Desktop never invokes anything.
 */
import { invoke } from "@/lib/invoke";
import { prefersDarkForeground } from "@/utils/appearance";
import { getPlatform } from "@/utils/platform";

let lastSent: boolean | null = null;

/** Push whether `bg` (the colour behind the bars) is light, i.e. needs dark icons. Decided
 *  from the colour itself (WCAG black-vs-white crossover) so custom themes work. */
export function syncSystemBars(bg: string): void {
  const lightBackground = prefersDarkForeground(bg);
  void getPlatform().then((p) => {
    if (p !== "android" || lightBackground === lastSent) return;
    lastSent = lightBackground;
    invoke("set_system_bars", { lightBackground }).catch(() => {
      lastSent = null;
    });
  });
}

/** Test hook: forget the last pushed value. */
export function resetSystemBarsForTest(): void {
  lastSent = null;
}
