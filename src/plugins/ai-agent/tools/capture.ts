import type { PluginAPI } from "@/plugins/api";
import type { CaptureOptions, RunCommandResult } from "../types";

export const MARKER_PREFIX = "__VLT_END_";

/** Wrap a command so its exit code prints on a unique sentinel line. */
export function buildMarkerCommand(command: string, nonce: string): string {
  return `${command}; printf '${MARKER_PREFIX}${nonce}__:%s\\n' "$?"`;
}

const DEFAULTS = { timeoutMs: 30_000, quietPeriodMs: 1_500, maxChars: 16_000 };

/**
 * Run `command` in an agent-owned session and capture its output + real exit
 * code via a sentinel marker. The agent owns the session (no user keystrokes
 * race), so completion is detected deterministically.
 *
 * - marker arrives → parse exitCode, strip the marker line.
 * - timeoutMs elapses with no marker → { exitCode: null, timedOut: true }.
 * - quiet-period floor: after the first output, if no new output for
 *   quietPeriodMs AND no marker, resolve early (non-POSIX shells that can't run
 *   the printf form) with exitCode null.
 */
export async function captureCommand(
  api: Pick<PluginAPI, "sessions" | "terminal">,
  sessionId: string,
  command: string,
  opts: CaptureOptions = {},
): Promise<RunCommandResult> {
  const { timeoutMs, quietPeriodMs, maxChars } = { ...DEFAULTS, ...opts };
  const nonce = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const markerRe = new RegExp(`${MARKER_PREFIX}${nonce}__:(-?\\d+)`);

  let buffer = "";
  let resolved = false;

  return new Promise<RunCommandResult>((resolve) => {
    let unsub: (() => void) | null = null;
    let hardTimer: ReturnType<typeof setTimeout> | null = null;
    let quietTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = (res: RunCommandResult) => {
      if (resolved) return;
      resolved = true;
      if (hardTimer) clearTimeout(hardTimer);
      if (quietTimer) clearTimeout(quietTimer);
      unsub?.();
      const truncated = res.output.length > maxChars;
      resolve({ ...res, output: truncated ? res.output.slice(0, maxChars) : res.output, truncated });
    };

    const armQuiet = () => {
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(() => {
        // no marker, output went quiet: degrade (non-POSIX floor)
        finish({ output: buffer.replace(/\n$/, ""), exitCode: null, timedOut: false, truncated: false });
      }, quietPeriodMs);
    };

    const onText = (text: string) => {
      buffer += text;
      const m = buffer.match(markerRe);
      if (m) {
        const exitCode = Number(m[1]);
        const output = buffer.slice(0, buffer.indexOf(m[0])).replace(/\n$/, "");
        finish({ output, exitCode, timedOut: false, truncated: false });
        return;
      }
      armQuiet();
    };

    hardTimer = setTimeout(() => {
      finish({ output: buffer.replace(/\n$/, ""), exitCode: null, timedOut: true, truncated: false });
    }, timeoutMs);

    void api.terminal
      .onOutput(sessionId, onText)
      .then((u) => {
        unsub = u;
        if (resolved) { u(); return; }
        return api.sessions.sendCommand(sessionId, buildMarkerCommand(command, nonce));
      })
      .catch((err) => finish({ output: `capture error: ${err instanceof Error ? err.message : String(err)}`, exitCode: null, timedOut: false, truncated: false }));
  });
}
