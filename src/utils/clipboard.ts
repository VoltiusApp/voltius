import { writeText, readText, readImage } from "@tauri-apps/plugin-clipboard-manager";

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

/** The clipboard image as PNG bytes, or null when it holds no image. */
export async function readClipboardImagePng(): Promise<Uint8Array | null> {
  let image: Awaited<ReturnType<typeof readImage>>;
  try {
    image = await readImage();
  } catch {
    return null;
  }
  try {
    const [rgba, { width, height }] = await Promise.all([image.rgba(), image.size()]);
    if (!width || !height) return null;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } finally {
    void image.close();
  }
}
