import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { fromInvokeRejection } from "@/services/backendErrors";

export { Channel } from "@tauri-apps/api/core";

/**
 * `invoke` from @tauri-apps/api/core, rejecting a coded backend error as a
 * `BackendError` rather than a plain object. The app's only way to call a
 * command (enforced by invoke.test.ts): Tauri locks `__TAURI_INTERNALS__.invoke`,
 * so the conversion cannot happen underneath it.
 */
export async function invoke<T>(...args: Parameters<typeof tauriInvoke>): Promise<T> {
  try {
    return await tauriInvoke<T>(...args);
  } catch (e) {
    throw fromInvokeRejection(e);
  }
}
