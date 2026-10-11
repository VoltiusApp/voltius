/** A buffer position that follows scrollback trimming: an xterm marker, or a fake in tests. */
export interface LineMark {
  readonly line: number;
  readonly isDisposed: boolean;
  dispose(): void;
}

export interface CommandMarkSource {
  /** A mark on the cursor's line, or null where marks make no sense (alternate screen). */
  mark(): LineMark | null;
  col(): number;
  now(): number;
}

/** One prompt and the command run from it. Lines are absolute buffer lines. */
export interface CommandRegion {
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

export interface CommandTracker {
  /** Feed one OSC 133 payload (`A`, `B`, `C`, `D;<exit>`, with optional extra parameters). */
  handle(payload: string): void;
  regions(): CommandRegion[];
}

interface Tracked {
  prompt: LineMark;
  input: { mark: LineMark; col: number } | null;
  output: LineMark | null;
  end: LineMark | null;
  exitCode: number | null;
  startedAt: number | null;
  endedAt: number | null;
}

const liveLine = (mark: LineMark | null) => (mark && !mark.isDisposed ? mark.line : null);

export function createCommandTracker(source: CommandMarkSource): CommandTracker {
  let tracked: Tracked[] = [];

  const dropTrimmed = () => {
    if (tracked.some((t) => t.prompt.isDisposed)) tracked = tracked.filter((t) => !t.prompt.isDisposed);
  };

  const handlers = new Map<string, (current: Tracked | undefined, args: string[]) => void>(Object.entries({
    A: (current) => {
      const mark = source.mark();
      if (!mark) return;
      // Two emitters (ours and the user's prompt) mark the same prompt twice.
      if (current && !current.output && current.prompt.line === mark.line) return mark.dispose();
      tracked.push({ prompt: mark, input: null, output: null, end: null, exitCode: null, startedAt: null, endedAt: null });
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
          promptLine: t.prompt.line,
          input: t.input && inputLine !== null ? { line: inputLine, col: t.input.col } : null,
          outputLine: liveLine(t.output),
          endLine: liveLine(t.end),
          exitCode: t.exitCode,
          startedAt: t.startedAt,
          endedAt: t.endedAt,
        };
      });
    },
  };
}
