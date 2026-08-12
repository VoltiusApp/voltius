import type { PluginAPI } from "@/plugins/api";
import type { CaptureOptions, RunCommandResult, SendKeysOptions, SendKeysResult } from "./types";

export const MARKER_PREFIX = "__VLT_END_";

/** Wrap a command so its exit code prints on a unique sentinel line. */
export function buildMarkerCommand(command: string, nonce: string): string {
  return `${command}; printf '${MARKER_PREFIX}${nonce}__:%s\\n' "$?"`;
}

const DEFAULTS = { timeoutMs: 30_000, quietPeriodMs: 10_000, maxChars: 16_000 };

// OSC: ESC ] ... terminated by BEL or ST (ESC \).
const OSC_RE = /\x1b\][\s\S]*?(?:\x07|\x1b\\)/g;
// CSI: ESC [ + parameter bytes (0x30-0x3F, incl. private markers like `?`) +
// intermediate bytes (0x20-0x2F) + a final byte (0x40-0x7E, `@`-`~`).
const CSI_RE = /\x1b\[[0-?]*[ -\/]*[@-~]/g;
// Charset designations, e.g. `\x1b(B`.
const CHARSET_RE = /\x1b[()#][0-9A-Za-z]/g;
// Other single-char Fe/Fp escapes, e.g. `\x1bM`, `\x1b7`, `\x1b=`.
const SIMPLE_ESC_RE = /\x1b[0-9A-Za-z=>]/g;

function stripAnsi(s: string): string {
  return s.replace(OSC_RE, "").replace(CSI_RE, "").replace(CHARSET_RE, "").replace(SIMPLE_ESC_RE, "");
}

/**
 * Find `needle` as a literal substring of `s`, ignoring any newlines the PTY
 * may have inserted into the middle of it (a hard line-wrap can split the
 * echoed marker token itself, not just the text before it). Returns the
 * index in `s` of the LAST character of the match, or -1 if `needle` isn't
 * present even after stripping newlines.
 */
function findIgnoringNewlines(s: string, needle: string): number {
  const map: number[] = [];
  let projected = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "\n") {
      map.push(i);
      projected += s[i];
    }
  }
  const idx = projected.indexOf(needle);
  if (idx === -1) return -1;
  return map[idx + needle.length - 1];
}

/**
 * Clean raw captured terminal text before handing it to the model: strip ANSI
 * escapes, normalize line endings, and drop the echoed command line (which
 * carries our printf marker wrapper as literal text the model was never meant
 * to see). The marker *result* line is handled separately by the caller (it's
 * sliced off before this runs, or absent on the timeout/quiet-period paths).
 *
 * The echoed line can be hard-wrapped by the PTY at terminal width, splitting
 * the marker format token itself across a newline, so the match is located on
 * a newline-stripped projection of the buffer and mapped back to a real
 * offset — everything through the end of the line containing the END of that
 * match is dropped. Matched on the literal `%s` form, which can never collide
 * with the marker RESULT line (`__:<digits>`), so real output is never eaten.
 */
export function cleanCapturedOutput(raw: string, nonce: string): string {
  let s = stripAnsi(raw);
  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "");
  const echoFormat = `${MARKER_PREFIX}${nonce}__:%s`;
  const endIdx = findIgnoringNewlines(s, echoFormat);
  if (endIdx !== -1) {
    const nl = s.indexOf("\n", endIdx);
    s = nl === -1 ? "" : s.slice(nl + 1);
  }
  return s.replace(/\n$/, "");
}

/**
 * Run `command` in an agent-owned session and capture its output + real exit
 * code via a sentinel marker. The agent owns the session (no user keystrokes
 * race), so completion is detected deterministically.
 *
 * Three resolution paths, all setting `incomplete` explicitly:
 * - marker arrives → parse exitCode, strip the marker line, `incomplete: false`.
 * - quiet-period floor: after the first output, if no new output for
 *   quietPeriodMs AND no marker, resolve early with exitCode null and
 *   `incomplete: true`. This exists only for non-POSIX shells that can't run
 *   the printf marker form; quietPeriodMs defaults high (10s) so it rarely
 *   fires for ordinary commands that merely pause mid-output.
 * - timeoutMs elapses with no marker → { exitCode: null, timedOut: true,
 *   incomplete: true }.
 *
 * `incomplete: true` tells the caller `output` may be partial and `exitCode`
 * is not to be trusted — distinct from `timedOut`, which only says *why* the
 * capture ended early.
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
        finish({ output: cleanCapturedOutput(buffer, nonce), exitCode: null, timedOut: false, truncated: false, incomplete: true });
      }, quietPeriodMs);
    };

    const onText = (text: string) => {
      buffer += text;
      const m = buffer.match(markerRe);
      if (m) {
        const exitCode = Number(m[1]);
        const output = cleanCapturedOutput(buffer.slice(0, buffer.indexOf(m[0])), nonce);
        finish({ output, exitCode, timedOut: false, truncated: false, incomplete: false });
        return;
      }
      armQuiet();
    };

    hardTimer = setTimeout(() => {
      finish({ output: cleanCapturedOutput(buffer, nonce), exitCode: null, timedOut: true, truncated: false, incomplete: true });
    }, timeoutMs);

    void api.terminal
      .onOutput(sessionId, onText)
      .then((u) => {
        unsub = u;
        if (resolved) { u(); return; }
        return api.sessions.sendCommand(sessionId, buildMarkerCommand(command, nonce));
      })
      .catch((err) => finish({ output: `capture error: ${err instanceof Error ? err.message : String(err)}`, exitCode: null, timedOut: false, truncated: false, incomplete: true }));
  });
}

/**
 * Write `text` to a serial session and return whatever the device emits.
 *
 * A serial device is not a shell: it never runs `captureCommand`'s sentinel,
 * so that marker syntax would be delivered to the device as literal input —
 * meaningless at best, and acted upon at worst on embedded hardware. Here the
 * text goes out verbatim and the reply is read back on a quiet period.
 *
 * `exitCode` is therefore always null and `incomplete` always true: there is
 * no completion signal to wait for, so the caller must never read the absence
 * of output as success. `timedOut` still distinguishes "the device went quiet"
 * from "nothing ever arrived".
 */
export async function sendSerialCommand(
  api: Pick<PluginAPI, "sessions" | "terminal">,
  sessionId: string,
  text: string,
  opts: CaptureOptions = {},
): Promise<RunCommandResult> {
  const { timeoutMs, quietPeriodMs, maxChars } = { ...DEFAULTS, ...opts };

  let buffer = "";
  let resolved = false;

  return new Promise<RunCommandResult>((resolve) => {
    let unsub: (() => void) | null = null;
    let hardTimer: ReturnType<typeof setTimeout> | null = null;
    let quietTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = (timedOut: boolean) => {
      if (resolved) return;
      resolved = true;
      if (hardTimer) clearTimeout(hardTimer);
      if (quietTimer) clearTimeout(quietTimer);
      unsub?.();
      const output = stripAnsi(buffer).replace(/\r\n/g, "\n").replace(/\r/g, "").replace(/\n$/, "");
      const truncated = output.length > maxChars;
      resolve({
        output: truncated ? output.slice(0, maxChars) : output,
        exitCode: null,
        timedOut,
        truncated,
        incomplete: true,
      });
    };

    const onText = (chunk: string) => {
      buffer += chunk;
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(() => finish(false), quietPeriodMs);
    };

    hardTimer = setTimeout(() => finish(true), timeoutMs);

    void api.terminal
      .onOutput(sessionId, onText)
      .then((u) => {
        unsub = u;
        if (resolved) { u(); return; }
        return api.sessions.sendCommand(sessionId, text);
      })
      .catch((err) => {
        buffer += `serial write error: ${err instanceof Error ? err.message : String(err)}`;
        finish(false);
      });
  });
}

const KEY_DEFAULTS = { quietMs: 300, timeoutMs: 5_000, maxLines: 200 };

/**
 * Write keystrokes to a session and return the screen once it stops changing.
 *
 * A TUI has no completion signal — no sentinel, no exit code — so the only
 * honest stop condition is "the screen stopped changing". The subscription is
 * established BEFORE the write: a fast redraw landing between write and
 * subscribe would otherwise be invisible and every call would run to the
 * deadline.
 *
 * The screen comes from the xterm buffer, not from the accumulated output: a
 * TUI's raw stream is cursor-positioning escapes that survive no useful
 * stripping, while the buffer is the rendered result.
 *
 * A write failure rejects rather than resolving with an empty screen — a caller
 * must never read "nothing changed" as "the keys landed and did nothing".
 */
export async function sendKeysToSession(
  api: Pick<PluginAPI, "sessions" | "terminal">,
  sessionId: string,
  text: string,
  opts: SendKeysOptions = {},
): Promise<SendKeysResult> {
  const { quietMs, timeoutMs, maxLines } = { ...KEY_DEFAULTS, ...opts };
  const unsub = await api.terminal.onOutput(sessionId, () => armQuiet());

  let settle: (settled: boolean) => void = () => {};
  const done = new Promise<boolean>((resolve) => { settle = resolve; });
  let quietTimer: ReturnType<typeof setTimeout> | null = null;

  const armQuiet = () => {
    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = setTimeout(() => settle(true), quietMs);
  };

  const hardTimer = setTimeout(() => settle(false), timeoutMs);
  armQuiet();

  try {
    await api.sessions.sendInput(sessionId, text);
  } catch (err) {
    clearTimeout(hardTimer);
    if (quietTimer) clearTimeout(quietTimer);
    unsub();
    throw err;
  }

  const settled = await done;
  clearTimeout(hardTimer);
  if (quietTimer) clearTimeout(quietTimer);
  unsub();
  return { screen: api.terminal.readSnapshot(sessionId, maxLines), settled, timedOut: !settled };
}
