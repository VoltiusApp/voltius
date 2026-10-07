import { open, save, type OpenDialogOptions, type SaveDialogOptions } from "@tauri-apps/plugin-dialog";
import { withLeaveLockSuppressed } from "@/services/leaveLockSuppression";

export function openSystemDialog<T extends OpenDialogOptions>(options: T) {
  return withLeaveLockSuppressed(() => open(options));
}

export function saveSystemDialog(options: SaveDialogOptions) {
  return withLeaveLockSuppressed(() => save(options));
}

/** Opens a file input's picker; the app lock waits until the picker reports back. */
export function pickWithFileInput(input: HTMLInputElement): void {
  void withLeaveLockSuppressed(
    () => new Promise<void>((done) => {
      input.addEventListener("change", () => done(), { once: true });
      input.addEventListener("cancel", () => done(), { once: true });
    }),
  );
  input.click();
}
