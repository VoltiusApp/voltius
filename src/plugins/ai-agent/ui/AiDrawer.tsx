import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { useAgentStore, getAgentDeps } from "../state/agentStore";
import { useUIStore } from "@/stores/uiStore";
import { Transcript } from "./Transcript";
import { Composer } from "./Composer";
import { FirstRunCard } from "./FirstRunCard";

const PIN_KEY = "drawerPinned";
const WIDTH_KEY = "drawerWidth";
const DEFAULT_WIDTH = 380;

/**
 * Whether an active provider profile is configured. null while the check is
 * in flight. `refresh()` re-runs the check on demand (e.g. after FirstRunCard
 * creates + activates profile #1) without needing `open` to re-toggle.
 */
function useHasProfile(open: boolean): [boolean | null, () => void] {
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!open) return;
    const deps = getAgentDeps();
    if (!deps) {
      setHasProfile(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const activeId = await deps.profiles.getActiveId();
      const profiles = await deps.profiles.list();
      const active = profiles.find((p) => p.id === activeId);
      if (!cancelled) setHasProfile(Boolean(active));
    })().catch(() => {
      if (!cancelled) setHasProfile(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, nonce]);

  return [hasProfile, () => setNonce((n) => n + 1)];
}

/** Persists the drawer's pin state + width via plugin storage. */
function usePinnedWidth() {
  const [pinned, setPinnedState] = useState(false);
  const [width, setWidthState] = useState(DEFAULT_WIDTH);

  useEffect(() => {
    const api = getAgentDeps()?.api;
    if (!api) return;
    let cancelled = false;
    Promise.all([api.storage.get<boolean>(PIN_KEY), api.storage.get<number>(WIDTH_KEY)]).then(([p, w]) => {
      if (cancelled) return;
      if (p != null) setPinnedState(p);
      if (w != null) setWidthState(w);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setPinned = (v: boolean) => {
    setPinnedState(v);
    void getAgentDeps()?.api.storage.set(PIN_KEY, v);
  };

  return { pinned, width, setPinned };
}

/**
 * Measures the top edge of `[data-shell-body]` (the row below TitleBar +
 * any EmailVerificationBanner) so a docked drawer can sit below the
 * titlebar instead of covering it. Falls back to 0 if the node isn't
 * found. Re-measures on window resize and whenever the shell body's own
 * size changes (a ResizeObserver on it catches the banner appearing or
 * disappearing, which resizes the flex-1 row).
 */
function useDockTop(active: boolean): number {
  const [top, setTop] = useState(0);

  useEffect(() => {
    if (!active) {
      setTop(0);
      return;
    }
    const measure = () => {
      const el = document.querySelector<HTMLElement>("[data-shell-body]");
      setTop(el ? el.getBoundingClientRect().top : 0);
    };
    measure();
    window.addEventListener("resize", measure);
    const el = document.querySelector<HTMLElement>("[data-shell-body]");
    let observer: ResizeObserver | undefined;
    if (el && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(measure);
      observer.observe(el);
    }
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [active]);

  return top;
}

export function AiDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const runStatus = useAgentStore((s) => s.runStatus);
  const [hasProfile, refreshHasProfile] = useHasProfile(open);
  const { pinned, width, setPinned } = usePinnedWidth();
  const setDockedPanelWidth = useUIStore((s) => s.setDockedPanelWidth);
  const dockTop = useDockTop(open && pinned);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // Pinned + open docks the drawer: reserve width on the app shell so it's pushed
  // aside instead of covered. Any other state (closed, unpinned, unmounted) frees it.
  useEffect(() => {
    setDockedPanelWidth(open && pinned ? width : 0);
    return () => setDockedPanelWidth(0);
  }, [open, pinned, width, setDockedPanelWidth]);

  if (!open) return null;

  const dotColor =
    runStatus === "streaming"
      ? "var(--t-status-connecting)"
      : runStatus === "error"
        ? "var(--t-status-error)"
        : "var(--t-status-connected)";

  return (
    <div
      role="dialog"
      aria-label="AI Agent"
      style={{
        position: "fixed",
        top: pinned ? dockTop : 0,
        right: 0,
        bottom: 0,
        width,
        maxWidth: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--t-bg-modal)",
        borderLeft: "1px solid var(--t-border)",
        boxShadow: "var(--t-elev-2)",
        zIndex: 50,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 12px",
          borderBottom: "1px solid var(--t-border)",
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor }} />
        <span style={{ color: "var(--t-text-bright)", fontWeight: 600, fontSize: 13 }}>AI Agent</span>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => setPinned(!pinned)}
          title={pinned ? "Unpin" : "Pin"}
          aria-pressed={pinned}
          style={{ background: "transparent", color: pinned ? "var(--t-accent)" : "var(--t-text-secondary)" }}
        >
          <Icon icon="lucide:pin" width={15} />
        </button>
        <button type="button" onClick={onClose} title="Close" style={{ background: "transparent", color: "var(--t-text-secondary)" }}>
          <Icon icon="lucide:x" width={16} />
        </button>
      </div>

      {hasProfile === false ? (
        <FirstRunCard onDone={refreshHasProfile} />
      ) : hasProfile === true ? (
        <>
          <Transcript />
          <Composer />
        </>
      ) : null}
    </div>
  );
}
