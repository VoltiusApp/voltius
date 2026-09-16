import { getTerminalApi } from "@/hooks/useTerminal";

const PASTE_CONTROL_RE = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;

export function sanitizePasteText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(PASTE_CONTROL_RE, "");
}

export async function pasteToSession(sessionId: string, text: string): Promise<boolean> {
  const clean = sanitizePasteText(text);
  let api = getTerminalApi(sessionId);
  if (!api) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    api = getTerminalApi(sessionId);
  }
  if (!api) {
    console.warn(`paste dropped: no terminal for session ${sessionId}`);
    return false;
  }
  api.paste(clean);
  return true;
}
