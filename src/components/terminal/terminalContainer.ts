import { useCallback, useEffect, useRef, type DependencyList } from "react";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import {
  attachTerminalClipboard,
  type TerminalClipboardHandle,
  type TerminalClipboardOptions,
} from "@/components/terminal/terminalClipboard";

/** A terminal that outlives the views it is mounted in. */
export interface CachedTerminal {
  terminal: Terminal;
  fitAddon: FitAddon;
  /** The current mount's clipboard: a view-owned one would paste into whichever session the view shows next. */
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

/** Move a cached terminal's element into a new view's container. */
export function reattachTerminal(entry: CachedTerminal, container: HTMLDivElement): void {
  if (entry.terminal.element) container.appendChild(entry.terminal.element);
  entry.fitAddon.fit();
}

function bindTerminalContainer(entry: CachedTerminal, container: HTMLDivElement, clipOptions?: TerminalClipboardOptions): () => void {
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
    // A pane that switches session keeps its container, which must not keep showing this buffer.
    terminal.element?.remove();
  };
}

/** Ref callback that mounts a cached terminal into its container and detaches it again,
 *  leaving the terminal alive for the next view. `mount` returns the entry, already in the container. */
export function useTerminalMount(
  mount: (container: HTMLDivElement) => CachedTerminal,
  clipOptions: TerminalClipboardOptions | undefined,
  deps: DependencyList,
): (container: HTMLDivElement | null) => void {
  const unbindRef = useRef<(() => void) | null>(null);
  const detach = () => {
    unbindRef.current?.();
    unbindRef.current = null;
  };
  useEffect(() => detach, []);
  return useCallback((container: HTMLDivElement | null) => {
    // React passes null on unmount and when this callback changes, as on a live pane switching session.
    if (!container) return detach();
    if (unbindRef.current) return;
    unbindRef.current = bindTerminalContainer(mount(container), container, clipOptions);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
