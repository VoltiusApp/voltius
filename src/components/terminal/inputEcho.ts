import type { IBuffer, Terminal } from "@xterm/xterm";
import type { EchoAnchor, EchoProbe } from "@/stores/commandHistoryStore";

/**
 * Where a line's echo would land: the cursor cell when its first character was
 * typed, held by an xterm marker so it follows the line as the buffer scrolls
 * or trims. Works on whichever screen was active — a shell inside tmux or
 * screen types on the alternate one.
 */
function anchorAt(term: Terminal): EchoAnchor | null {
  const screen = term.buffer.active;
  const kind = screen.type;
  const row = screen.baseY + screen.cursorY;
  const col = screen.cursorX;
  // A fresh row has no prompt on it yet. Whatever the program prints there after
  // the keystroke would read as an echo, so typing ahead of a prompt is never kept.
  if (col === 0 && !screen.getLine(row)?.isWrapped) return null;
  const marker = term.registerMarker(0);
  if (!marker || marker.isDisposed) return null;
  const buffer = (): IBuffer => (kind === "alternate" ? term.buffer.alternate : term.buffer.normal);

  // The last row of the logical line the marker sits on: a long line wraps onto rows flagged isWrapped.
  const lastRow = (b: IBuffer) => {
    let last = marker.line;
    while (b.getLine(last + 1)?.isWrapped) last += 1;
    return last;
  };

  return {
    text() {
      if (marker.isDisposed) return null;
      const b = buffer();
      const first = b.getLine(marker.line);
      if (!first) return null;
      // Untrimmed per row: a space typed at a wrap boundary is part of the line.
      let shown = first.translateToString(false, col);
      for (let r = marker.line + 1; r <= lastRow(b); r += 1) {
        shown += b.getLine(r)?.translateToString(false) ?? "";
      }
      return shown;
    },
    left() {
      if (marker.isDisposed || term.buffer.active.type !== kind) return true;
      const b = buffer();
      const cursor = b.baseY + b.cursorY;
      return cursor < marker.line || cursor > lastRow(b);
    },
    dispose() {
      marker.dispose();
    },
  };
}

/** What the command history needs from a session's terminal to tell an echoed line from a hidden one. */
export function terminalEchoProbe(term: Terminal): EchoProbe {
  return {
    anchor: () => anchorAt(term),
    onOutput: (cb) => {
      const sub = term.onWriteParsed(cb);
      return () => sub.dispose();
    },
  };
}
