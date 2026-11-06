import type { EchoProbe } from "@/stores/commandHistoryStore";

/** A terminal that echoes `line` after the prompt, for tests that need a typed line kept. */
export function echoedAs(line: string): EchoProbe {
  return {
    anchor: () => ({ text: () => line, left: () => false, dispose() {} }),
    promptAnchor: () => null,
    onOutput: () => () => {},
  };
}
