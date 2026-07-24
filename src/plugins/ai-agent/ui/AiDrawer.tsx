import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { useAgentStore, _getDeps } from "../state/agentStore";
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
    const deps = _getDeps();
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
    const api = _getDeps()?.api;
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
    void _getDeps()?.api.storage.set(PIN_KEY, v);
  };

  return { pinned, width, setPinned };
}

export function AiDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const runStatus = useAgentStore((s) => s.runStatus);
  const [hasProfile, refreshHasProfile] = useHasProfile(open);
  const { pinned, width, setPinned } = usePinnedWidth();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

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
        top: 0,
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
