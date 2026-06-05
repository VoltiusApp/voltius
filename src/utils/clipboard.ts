import { writeText, readText } from "@tauri-apps/plugin-clipboard-manager";

export async function writeClipboard(text: string): Promise<void> {
  try {
    await writeText(text);
  } catch {
    await navigator.clipboard.writeText(text);
  }
}

export async function readClipboard(): Promise<string> {
  try {
    return await readText();
  } catch {
    return await navigator.clipboard.readText();
  }
}
