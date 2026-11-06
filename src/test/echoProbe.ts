import type { EchoProbe } from "@/stores/commandHistoryStore";

/**
 * A terminal that shows `line` after the prompt: the history's echo check for
 * tests that are about something else and need a typed line to be kept. The
 * echo check itself is exercised against a real xterm in commandHistoryStore.test.ts.
 */
export function echoedAs(line: string): EchoProbe {
  return {
    anchor: () => ({ text: () => line, left: () => false, dispose() {} }),
    onOutput: () => () => {},
  };
}
