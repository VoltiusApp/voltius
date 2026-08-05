import type { GlobalPanelHandle } from "@/plugins/api";

/**
 * The drawer's `registerGlobalPanel` handle, published here at register() time.
 *
 * The touchpoints that open the drawer (title-bar button, terminal button,
 * omni commands, approval toasts) are mounted far from register(), and the
 * handle's methods close over the host-prefixed panel id — so a module-level
 * singleton is what replaces reaching into the host's uiStore. Null before
 * register() and after teardown; every accessor is a no-op then rather than
 * throwing, since a disabled plugin's stale UI must not crash the host.
 */
let _handle: GlobalPanelHandle | null = null;

export function setPanelHandle(handle: GlobalPanelHandle | null): void {
  _handle = handle;
}

export function openPanel(): void {
  _handle?.open();
}

export function togglePanel(): void {
  _handle?.toggle();
}

export function isPanelOpen(): boolean {
  return _handle?.isOpen() ?? false;
}

export function setPanelDockedWidth(width: number): void {
  _handle?.setDockedWidth(width);
}
