/** A buffer position that follows scrollback trimming: an xterm marker, or a fake in tests. */
export interface LineMark {
  readonly line: number;
  readonly isDisposed: boolean;
  dispose(): void;
}

export interface CommandMarkSource {
  /** A mark on `line` (the cursor's line when omitted), or null where marks make no sense (alternate screen). */
  mark(line?: number): LineMark | null;
  col(): number;
  now(): number;
}

/** One prompt and the command run from it. Lines are absolute buffer lines. */
export interface CommandRegion {
  /** 0 once the prompt has left the scrollback while some of the output is still in it. */
  promptLine: number;
  /** Where typed input starts. Null unless the shell's own prompt sends B. */
  input: { line: number; col: number } | null;
  /** Null while no command has run from this prompt. */
  outputLine: number | null;
  /** First line after the output, where the next prompt starts. */
  endLine: number | null;
  exitCode: number | null;
  startedAt: number | null;
  /** Null while the command is still running. */
  endedAt: number | null;
}

/** Lines of command output, end exclusive. `open`: still running, or its end was never reported. */
export interface OutputSpan {
  start: number;
  end: number;
  open: boolean;
}

export interface CommandTracker {
  /** Feed one OSC 133 payload (`A`, `B`, `C`, `D;<exit>`, with optional extra parameters). */
  handle(payload: string): void;
  regions(): CommandRegion[];
  /** Output spans that intersect lines `[top, bottom)`, oldest first. */
  outputSpans(top: number, bottom: number, bufferEnd: number): OutputSpan[];
  /** Call before the screen is erased with the cursor on `line`: the erase kills marks whose text never scrolled away. */
  erased(line: number): void;
}

interface Tracked {
  prompt: LineMark;
  input: { mark: LineMark; col: number } | null;
  output: LineMark | null;
  end: LineMark | null;
  exitCode: number | null;
  startedAt: number | null;
  endedAt: number | null;
  /** The prompt was trimmed off the top of the scrollback, not wiped by an erase. */
  clipped: boolean;
}

const liveLine = (mark: LineMark | null) => (mark && !mark.isDisposed ? mark.line : null);

export function createCommandTracker(source: CommandMarkSource): CommandTracker {
  let tracked: Tracked[] = [];

  const isRunning = (t: Tracked) => t === tracked[tracked.length - 1] && !!t.output && t.endedAt === null;

  const endOf = (t: Tracked, next: Tracked | undefined) => liveLine(t.end) ?? (next ? liveLine(next.prompt) : null);

  // A command outlives its trimmed prompt for as long as some of its output is still in the buffer.
  const isGone = (t: Tracked, next: Tracked | undefined) => {
    if (!t.prompt.isDisposed || isRunning(t)) return false;
    return !t.clipped || !t.output || (endOf(t, next) ?? 0) <= 0;
  };

  let erasure: { line: number; prompt: boolean; output: boolean } | null = null;

  // An erase kills the newest command's marks while its text stays on screen: they come back at the cursor.
  const restoreErased = () => {
    const last = tracked[tracked.length - 1];
    if (erasure && last) {
      if (erasure.prompt && last.prompt.isDisposed) last.prompt = source.mark(erasure.line) ?? last.prompt;
      if (erasure.output && last.output?.isDisposed) last.output = source.mark(erasure.line) ?? last.output;
    }
    erasure = null;
  };

  const noteClipped = () => {
    for (const t of tracked) if (t.prompt.isDisposed) t.clipped = true;
  };

  const dropTrimmed = () => {
    if (erasure) restoreErased();
    else noteClipped();
    if (!tracked.some((t) => t.prompt.isDisposed)) return;
    // Newest first: a command's end falls back to the next prompt that itself survives.
    const kept: Tracked[] = [];
    for (let i = tracked.length - 1; i >= 0; i--) {
      if (!isGone(tracked[i], kept[kept.length - 1])) kept.push(tracked[i]);
    }
    tracked = kept.reverse();
  };

  const handlers = new Map<string, (current: Tracked | undefined, args: string[]) => void>(Object.entries({
    A: (current) => {
      const mark = source.mark();
      if (!mark) return;
      // Two emitters (ours and the user's prompt) mark the same prompt twice.
      if (current && !current.output && current.prompt.line === mark.line) return mark.dispose();
      tracked.push({ prompt: mark, input: null, output: null, end: null, exitCode: null, startedAt: null, endedAt: null, clipped: false });
    },
    B: (current) => {
      if (!current || current.output) return;
      const mark = source.mark();
      if (!mark) return;
      current.input?.mark.dispose();
      current.input = { mark, col: source.col() };
    },
    C: (current) => {
      if (!current || current.output) return;
      current.output = source.mark();
      if (current.output) current.startedAt = source.now();
    },
    // Shells report the last status at every prompt, so a D with no command before it means nothing.
    D: (current, args) => {
      if (!current?.output || current.endedAt !== null) return;
      current.end = source.mark();
      current.exitCode = /^-?\d+$/.test(args[0] ?? "") ? Number(args[0]) : null;
      current.endedAt = source.now();
    },
  }));

  return {
    handle(payload) {
      const [kind, ...args] = payload.split(";");
      const handler = handlers.get(kind);
      if (!handler) return;
      dropTrimmed();
      handler(tracked[tracked.length - 1], args);
    },
    regions() {
      dropTrimmed();
      return tracked.map((t) => {
        const inputLine = liveLine(t.input?.mark ?? null);
        return {
          promptLine: liveLine(t.prompt) ?? 0,
          input: t.input && inputLine !== null ? { line: inputLine, col: t.input.col } : null,
          outputLine: t.output ? liveLine(t.output) ?? 0 : null,
          endLine: liveLine(t.end),
          exitCode: t.exitCode,
          startedAt: t.startedAt,
          endedAt: t.endedAt,
        };
      });
    },
    outputSpans(top, bottom, bufferEnd) {
      dropTrimmed();
      const spans: OutputSpan[] = [];
      for (let i = tracked.length - 1; i >= 0; i--) {
        const t = tracked[i];
        const next: Tracked | undefined = tracked[i + 1];
        if (!t.output) {
          if (t.prompt.line < top) break;
          continue;
        }
        const outputLine = liveLine(t.output);
        const end = endOf(t, next) ?? bufferEnd;
        if (end <= top) break;
        // A lost start under a surviving prompt was erased, not trimmed: that output is gone.
        if (outputLine === null && !t.prompt.isDisposed) continue;
        const start = outputLine ?? 0;
        if (start < bottom && end > start) spans.unshift({ start, end, open: !t.end && !next });
      }
      return spans;
    },
    erased(line) {
      if (!erasure) noteClipped();
      const last = tracked[tracked.length - 1];
      const open = !!last && last.endedAt === null;
      erasure = {
        line,
        prompt: erasure?.prompt ?? (open && !last.prompt.isDisposed),
        output: erasure?.output ?? (open && liveLine(last.output) !== null),
      };
    },
  };
}
