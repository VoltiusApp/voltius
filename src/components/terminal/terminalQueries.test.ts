import { describe, expect, it } from "vitest";
import { Terminal } from "@xterm/xterm";
import { suppressTerminalQueries } from "./terminalQueries";

const replies = (term: Terminal, input: string) =>
  new Promise<string[]>((resolve) => {
    const out: string[] = [];
    const sub = term.onData((d) => out.push(d));
    term.write(input, () => {
      sub.dispose();
      resolve(out);
    });
  });

const QUERIES = [
  "\x1b[c", "\x1b[0c", "\x1b[>c", "\x1b[=c", "\x1b[5n", "\x1b[6n", "\x1b[?6n",
  "\x1b[?2004$p", "\x1b[4$p", "\x1b[>q", "\x1b[18t", "\x1b[14t", "\x1b[?u",
  "\x1b]10;?\x07", "\x1b]11;?\x1b\\", "\x1b]12;?\x07", "\x1b]4;1;?\x07", "\x1bP$qm\x1b\\",
];

describe("suppressTerminalQueries", () => {
  it("xterm answers queries on its own", async () => {
    const term = new Terminal({ allowProposedApi: true });
    expect(await replies(term, "\x1b[c")).toHaveLength(1);
    expect(await replies(term, "\x1b[6n")).toHaveLength(1);
  });

  it("swallows every query reply while installed and restores them on dispose", async () => {
    const term = new Terminal({ allowProposedApi: true });
    const guard = suppressTerminalQueries(term);
    for (const q of QUERIES) expect(await replies(term, q), JSON.stringify(q)).toEqual([]);
    guard.dispose();
    expect(await replies(term, "\x1b[c")).toHaveLength(1);
  });

  it("leaves non-query sequences working", async () => {
    const term = new Terminal({ allowProposedApi: true });
    suppressTerminalQueries(term);
    await replies(term, "ab\x1b[1;1Hc");
    expect(term.buffer.active.getLine(0)?.translateToString(true)).toBe("cb");
  });
});
