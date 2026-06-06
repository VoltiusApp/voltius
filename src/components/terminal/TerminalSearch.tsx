import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
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
  const inputRef = useRef<HTMLInputElement | null>(null);

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

  // Focus & select-all whenever the widget opens (or is re-opened while open).
  useEffect(() => {
    if (snapshot.open && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [snapshot.open, snapshot.focusTick]);

  if (!controller || !snapshot.open) return null;

  const { query, caseSensitive, wholeWord, regex, resultIndex, resultCount, invalidRegex } = snapshot;
  const hasQuery = query.length > 0;
  const showNoResults = hasQuery && resultCount === 0 && !invalidRegex;
  const showError = invalidRegex || showNoResults;

  const counter = !hasQuery
    ? ""
    : invalidRegex
      ? "Invalid"
      : resultCount === 0
        ? "No results"
        : `${resultIndex + 1} of ${resultCount}`;

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      controller!.close();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) controller!.prev();
      else controller!.next();
      return;
    }
    if (e.altKey && (e.key === "c" || e.key === "C")) {
      e.preventDefault();
      controller!.toggleCaseSensitive();
      return;
    }
    if (e.altKey && (e.key === "w" || e.key === "W")) {
      e.preventDefault();
      controller!.toggleWholeWord();
      return;
    }
    if (e.altKey && (e.key === "r" || e.key === "R")) {
      e.preventDefault();
      controller!.toggleRegex();
      return;
    }
  }

  return (
    <div
      className="absolute top-2 right-2 z-30 flex items-center gap-1 rounded-lg animate-fadeIn"
      style={{
        background: "var(--t-bg-modal)",
        border: "1px solid var(--t-border-hover)",
        padding: "5px 6px",
        width: "min(420px, calc(100% - 16px))",
        boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <Icon
        icon="lucide:search"
        width={13}
        className="shrink-0 ml-1.5 mr-0.5"
        style={{ color: "var(--t-text-dim)" }}
      />

      <div className="relative flex-1 min-w-0">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => controller.setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          autoComplete="off"
          placeholder="Find"
          className="w-full bg-transparent text-sm outline-hidden px-1 py-1 text-(--t-text-primary) placeholder-(--t-text-muted)"
          style={{
            boxShadow: showError ? "inset 2px 0 0 var(--t-status-error, #ef4444)" : undefined,
          }}
        />
      </div>

      <span
        className="text-xs tabular-nums whitespace-nowrap px-1.5 select-none"
        style={{
          color: showError ? "var(--t-status-error, #ef4444)" : "var(--t-text-dim)",
        }}
      >
        {counter}
      </span>

      <div className="flex items-center gap-0.5 pl-1 ml-0.5" style={{ borderLeft: "1px solid var(--t-border)" }}>
        <ToggleChip active={caseSensitive} title="Match Case (Alt+C)" onClick={controller.toggleCaseSensitive}>
          <span className="font-semibold" style={{ fontSize: "11px", letterSpacing: "-0.5px" }}>Aa</span>
        </ToggleChip>
        <ToggleChip active={wholeWord} title="Match Whole Word (Alt+W)" onClick={controller.toggleWholeWord}>
          <span
            className="font-semibold"
            style={{ fontSize: "11px", letterSpacing: "-0.5px", borderBottom: "1.5px solid currentColor", paddingBottom: 0, lineHeight: 1 }}
          >
            ab
          </span>
        </ToggleChip>
        <ToggleChip active={regex} title="Use Regular Expression (Alt+R)" onClick={controller.toggleRegex}>
          <span className="font-semibold" style={{ fontSize: "11px", letterSpacing: "-0.5px" }}>.*</span>
        </ToggleChip>
      </div>

      <div className="flex items-center gap-0.5 pl-0.5">
        <IconButton
          title="Previous Match (Shift+Enter)"
          icon="lucide:chevron-up"
          disabled={!hasQuery || resultCount === 0}
          onClick={controller.prev}
        />
        <IconButton
          title="Next Match (Enter)"
          icon="lucide:chevron-down"
          disabled={!hasQuery || resultCount === 0}
          onClick={controller.next}
        />
        <IconButton title="Close (Escape)" icon="lucide:x" onClick={controller.close} />
      </div>
    </div>
  );
}

// ─── Local controls ──────────────────────────────────────────────────────────

function ToggleChip({
  active,
  title,
  onClick,
  children,
}: {
  active: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      onMouseDown={(e) => e.preventDefault()}
      className="rounded-sm transition-colors flex items-center justify-center select-none"
      style={{
        width: "22px",
        height: "22px",
        background: active ? "var(--t-accent)" : "transparent",
        color: active ? "var(--t-bg-terminal)" : "var(--t-text-dim)",
        border: active ? "1px solid var(--t-accent)" : "1px solid transparent",
      }}
      onMouseEnter={(e) => {
        if (active) return;
        e.currentTarget.style.background = "var(--t-bg-elevated)";
        e.currentTarget.style.color = "var(--t-text-primary)";
      }}
      onMouseLeave={(e) => {
        if (active) return;
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "var(--t-text-dim)";
      }}
    >
      {children}
    </button>
  );
}

function IconButton({
  icon,
  title,
  onClick,
  disabled,
}: {
  icon: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      onMouseDown={(e) => e.preventDefault()}
      disabled={disabled}
      className="rounded-sm transition-colors flex items-center justify-center"
      style={{
        width: "22px",
        height: "22px",
        background: "transparent",
        color: "var(--t-text-dim)",
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = "var(--t-bg-elevated)";
        e.currentTarget.style.color = "var(--t-text-primary)";
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "var(--t-text-dim)";
      }}
    >
      <Icon icon={icon} width={14} />
    </button>
  );
}

export default TerminalSearch;
