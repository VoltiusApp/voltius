// Vendored rather than imported from "@/utils/clipboard": external plugin bundles
// cannot reach across the host-internal path boundary (see src/plugins/ssh-config/
// index.ts's "Inlined from @/types" note for the same constraint applied to types).
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

export async function writeClipboard(text: string): Promise<void> {
  try {
    await writeText(text);
  } catch {
    await navigator.clipboard.writeText(text);
  }
}
