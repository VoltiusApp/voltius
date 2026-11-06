import type { IBuffer, IBufferLine, Terminal } from "@xterm/xterm";
import type { EchoAnchor, EchoProbe, PromptAnchor } from "@/stores/commandHistoryStore";

const screenOf = (term: Terminal, kind: string): IBuffer =>
  kind === "alternate" ? term.buffer.alternate : term.buffer.normal;

function lastRowOf(b: IBuffer, row: number): number {
  let last = row;
  while (b.getLine(last + 1)?.isWrapped) last += 1;
  return last;
}

// Untrimmed per row: a space typed at a wrap boundary is part of the line.
function lineFrom(b: IBuffer, first: IBufferLine, row: number, col: number): string {
  let shown = first.translateToString(false, col);
  for (let r = row + 1; r <= lastRowOf(b, row); r += 1) shown += b.getLine(r)?.translateToString(false) ?? "";
  return shown;
}

function anchorAt(term: Terminal): EchoAnchor | null {
  const screen = term.buffer.active;
  const kind = screen.type;
  const row = screen.baseY + screen.cursorY;
  const col = screen.cursorX;
  // A fresh row has no prompt on it yet: output printed there would pass for an echo.
  if (col === 0 && !screen.getLine(row)?.isWrapped) return null;
  const marker = term.registerMarker(0);
  if (!marker || marker.isDisposed) return null;

  return {
    text() {
      if (marker.isDisposed) return null;
      const b = screenOf(term, kind);
      const first = b.getLine(marker.line);
      return first ? lineFrom(b, first, marker.line, col) : null;
    },
    left() {
      if (marker.isDisposed || term.buffer.active.type !== kind) return true;
      const b = screenOf(term, kind);
      const cursor = b.baseY + b.cursorY;
      return cursor < marker.line || cursor > lastRowOf(b, marker.line);
    },
    dispose() {
      marker.dispose();
    },
  };
}

// zsh leaves RPROMPT on the accepted line, right-aligned and set apart by a gap.
function withoutRightPrompt(line: string, row: IBufferLine, cols: number): string {
  if (row.translateToString(true).length < cols - 2) return line;
  const gap = line.search(/\S {2,}\S/);
  return gap < 0 ? line : line.slice(0, gap + 1);
}

function promptAnchorAt(term: Terminal, ahead: string): PromptAnchor | null {
  const screen = term.buffer.active;
  if (screen.type !== "normal") return null;
  const line = screen.getLine(screen.baseY + screen.cursorY);
  if (!line) return null;
  let col = screen.cursorX;
  let prompt = line.translateToString(false, 0, col);
  // Keys typed before the prompt appeared are redrawn after it, ahead of the cursor.
  if (ahead && /^[\x20-\x7e]+$/.test(ahead) && prompt.endsWith(ahead)) {
    col -= ahead.length;
    prompt = prompt.slice(0, col);
  }
  const marker = term.registerMarker(0);
  if (!marker || marker.isDisposed) return null;

  return {
    command() {
      const b = term.buffer.normal;
      if (marker.isDisposed || term.buffer.active.type !== "normal") return null;
      const first = b.getLine(marker.line);
      // A redrawn prompt (transient prompt, Ctrl+L) no longer puts the command at `col`.
      if (!first || first.translateToString(false, 0, col) !== prompt) return null;
      const last = lastRowOf(b, marker.line);
      // The command runs from the row right below it; anything else is a multi-line command.
      if (b.baseY + b.cursorY !== last + 1) return null;
      const text = lineFrom(b, first, marker.line, col);
      return last === marker.line ? withoutRightPrompt(text, first, term.cols) : text;
    },
    dispose() {
      marker.dispose();
    },
  };
}

export function terminalEchoProbe(term: Terminal): EchoProbe {
  return {
    anchor: () => anchorAt(term),
    promptAnchor: (ahead) => promptAnchorAt(term, ahead),
    onOutput: (cb) => {
      const sub = term.onWriteParsed(cb);
      return () => sub.dispose();
    },
  };
}
