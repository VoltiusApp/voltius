import { WebglAddon } from "@xterm/addon-webgl";

// WebKitGTK presents a WebGL canvas one draw behind unless the buffer is preserved,
// so terminal echo only appears on the next redraw (cursor blink, ~600 ms). #224
const PRESERVE_DRAWING_BUFFER =
  typeof navigator !== "undefined" && /Linux/.test(navigator.userAgent) && !/Android/i.test(navigator.userAgent);

export function createWebglAddon(): WebglAddon {
  return new WebglAddon(PRESERVE_DRAWING_BUFFER);
}
