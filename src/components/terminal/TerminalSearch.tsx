import { useEffect, useState } from "react";
import { FindBar, type FindOption } from "@/components/shared/FindBar";
import { getTerminalSearchController, type TerminalSearchController, type TerminalSearchSnapshot } from "@/hooks/useTerminal";

const EMPTY: TerminalSearchSnapshot = {
  open: false,
  query: "",
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  resultIndex: -1,
  resultCount: 0,
  invalidRegex: false,
  focusTick: 0,
};

export function TerminalSearch({ sessionId }: { sessionId: string }) {
  const [controller, setController] = useState<TerminalSearchController | null>(
    () => getTerminalSearchController(sessionId),
  );
  const [snapshot, setSnapshot] = useState<TerminalSearchSnapshot>(
    () => controller?.getSnapshot() ?? EMPTY,
  );

  // Attach to the per-session controller as soon as the terminal cache entry exists.
  // The cache is populated by useTerminal's attach callback, which may run after
  // TerminalSearch's first render, so we poll for one frame before giving up.
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let frame = 0;
    let cancelled = false;

    const tryAttach = () => {
      if (cancelled) return;
      const c = getTerminalSearchController(sessionId);
      if (c) {
        setController(c);
        setSnapshot(c.getSnapshot());
        unsubscribe = c.subscribe(() => setSnapshot(c.getSnapshot()));
        return;
      }
      frame = requestAnimationFrame(tryAttach);
    };
    tryAttach();

    return () => {
      cancelled = true;
      if (frame) cancelAnimationFrame(frame);
      unsubscribe?.();
    };
  }, [sessionId]);

  if (!controller || !snapshot.open) return null;

  return (
    <FindBar
      query={snapshot.query}
      onQueryChange={controller.setQuery}
      caseSensitive={snapshot.caseSensitive}
      wholeWord={snapshot.wholeWord}
      regex={snapshot.regex}
      onToggle={(option) => TOGGLES[option](controller)}
      resultIndex={snapshot.resultIndex}
      resultCount={snapshot.resultCount}
      invalidRegex={snapshot.invalidRegex}
      onNext={controller.next}
      onPrev={controller.prev}
      onClose={controller.close}
      focusTick={snapshot.focusTick}
    />
  );
}

const TOGGLES: Record<FindOption, (c: TerminalSearchController) => void> = {
  caseSensitive: (c) => c.toggleCaseSensitive(),
  wholeWord: (c) => c.toggleWholeWord(),
  regex: (c) => c.toggleRegex(),
};

export default TerminalSearch;
