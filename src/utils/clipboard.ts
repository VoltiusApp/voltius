import { writeText, readText } from "@tauri-apps/plugin-clipboard-manager";
import { invoke } from "@/lib/invoke";

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

/** Copy a loaded `<img>` as pixels, so every format, SVG included, lands on the clipboard the same way. */
export async function writeClipboardImage(img: HTMLImageElement): Promise<void> {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx || !canvas.width || !canvas.height) throw new Error("image has no pixels");
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  await invoke("clipboard_write_rgba", new Uint8Array(data.buffer), {
    headers: { width: String(canvas.width), height: String(canvas.height) },
  });
}
