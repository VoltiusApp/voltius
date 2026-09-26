import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import {
  attachTerminalClipboard,
  type TerminalClipboardHandle,
  type TerminalClipboardOptions,
} from "@/components/terminal/terminalClipboard";

/** A terminal that outlives the views it is mounted in (see useTerminal's cache). */
export interface CachedTerminal {
  terminal: Terminal;
  fitAddon: FitAddon;
  /** Clipboard handle of the mount this terminal is currently attached to. Lives
   *  on the entry, not on the view: a mount that switches session keeps its refs,
   *  so a view-owned handle would send this terminal's Ctrl+V to the new session. */
  clip: TerminalClipboardHandle | null;
}

/** Dispose and drop every cached terminal whose session tab is gone. */
export function disposeClosedTerminals(cache: Map<string, { dispose(): void }>, sessions: { id: string }[]): void {
  const open = new Set(sessions.map((s) => s.id));
  for (const [id, entry] of cache) {
    if (open.has(id)) continue;
    entry.dispose();
    cache.delete(id);
  }
}

/**
 * Container-specific listeners for a cached terminal, registered on each mount
 * and torn down by the returned function when the view detaches. The teardown
 * also pulls the terminal element out of the container: a pane that switches
 * session keeps the same container node, so leaving the old element behind
 * would show the previous session's buffer.
 */
export function bindTerminalContainer(
  entry: CachedTerminal,
  container: HTMLDivElement,
  clipOptions?: TerminalClipboardOptions,
): () => void {
  const { terminal, fitAddon } = entry;
  const clip = attachTerminalClipboard(terminal, container, clipOptions);
  entry.clip = clip;

  const handleWindowResize = () => fitAddon.fit();
  window.addEventListener("resize", handleWindowResize);

  let fitTimer: ReturnType<typeof setTimeout> | null = null;
  const resizeObserver = new ResizeObserver(() => {
    if (fitTimer !== null) clearTimeout(fitTimer);
    fitTimer = setTimeout(() => { fitTimer = null; fitAddon.fit(); }, 50);
  });
  resizeObserver.observe(container);

  return () => {
    clip.dispose();
    if (entry.clip === clip) entry.clip = null;
    window.removeEventListener("resize", handleWindowResize);
    resizeObserver.disconnect();
    if (fitTimer !== null) clearTimeout(fitTimer);
    terminal.element?.remove();
  };
}
