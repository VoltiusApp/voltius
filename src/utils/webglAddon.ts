import type { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";

// WebKitGTK presents a WebGL canvas one draw behind unless the buffer is preserved,
// so terminal echo only appears on the next redraw (cursor blink, ~600 ms). #224
const PRESERVE_DRAWING_BUFFER =
  typeof navigator !== "undefined" && /Linux/.test(navigator.userAgent) && !/Android/i.test(navigator.userAgent);

// Engines kill the oldest WebGL context past 16 per page (8 on Android), leaving a dead canvas.
const MAX_WEBGL_TERMINALS = 8;

const pool = new Map<Terminal, PooledWebglAddon>();

class PooledWebglAddon extends WebglAddon {
  readonly term: Terminal;

  constructor(term: Terminal) {
    super(PRESERVE_DRAWING_BUFFER);
    this.term = term;
  }

  override dispose(): void {
    if (pool.get(this.term) === this) pool.delete(this.term);
    // The addon never releases its context, and a disposed one still counts against the cap until GC.
    const gl = (this as unknown as { _renderer?: { _gl?: WebGL2RenderingContext } })._renderer?._gl;
    super.dispose();
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  }
}

/** Render `term` with WebGL, evicting the least recently claimed terminal back to the DOM renderer. */
export function claimWebglRenderer(term: Terminal): void {
  const held = pool.get(term);
  if (held) {
    pool.delete(term);
    pool.set(term, held);
    return;
  }
  let addon: PooledWebglAddon;
  try {
    addon = new PooledWebglAddon(term);
    term.loadAddon(addon);
  } catch {
    return;
  }
  addon.onContextLoss(() => addon.dispose());
  pool.set(term, addon);
  while (pool.size > MAX_WEBGL_TERMINALS) pool.values().next().value!.dispose();
}
