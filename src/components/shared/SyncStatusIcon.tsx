import { useEffect, useState, useSyncExternalStore } from "react";
import { Icon } from "@iconify/react";
import type { SyncStatus } from "@/services/sync";
import { syncStatusIcon } from "@/services/syncStatus";
import { isManualSyncRunning, onManualSyncChange } from "@/services/syncIntent";

type Motion = "none" | "breathe" | "arc";

const BACKGROUND_DELAY_MS = 400;
const ARC_TURN_MS = 750;

export interface SyncMotion {
  motion: Motion;
  /** What the icon currently shows: "syncing" only while it moves. */
  status: SyncStatus;
  resting: SyncStatus;
  endTurn: () => void;
}

export function useSyncMotion(status: SyncStatus): SyncMotion {
  const manual = useSyncExternalStore(onManualSyncChange, isManualSyncRunning);
  const syncing = status === "syncing";
  const [motion, setMotion] = useState<Motion>("none");
  const [settled, setSettled] = useState<SyncStatus>(syncing ? "idle" : status);
  if (!syncing && settled !== status) setSettled(status);

  if (syncing && manual && motion !== "arc") setMotion("arc");
  if (!syncing && motion === "breathe") setMotion("none");

  useEffect(() => {
    if (!syncing || manual) return;
    const timer = setTimeout(() => setMotion((m) => (m === "none" ? "breathe" : m)), BACKGROUND_DELAY_MS);
    return () => clearTimeout(timer);
  }, [syncing, manual]);

  // animationiteration never fires in a hidden window, so a timer bounds the last turn.
  useEffect(() => {
    if (syncing || motion !== "arc") return;
    const timer = setTimeout(() => setMotion("none"), ARC_TURN_MS);
    return () => clearTimeout(timer);
  }, [syncing, motion]);

  const resting = syncing ? settled : status;
  return {
    motion,
    status: motion === "none" ? resting : "syncing",
    resting,
    endTurn: () => { if (!syncing) setMotion("none"); },
  };
}

interface SyncStatusIconProps {
  sync: SyncMotion;
  width: number;
  className?: string;
  style?: React.CSSProperties;
}

/** Colour comes from `currentColor`; derive it from `sync.status`, not the raw engine status. */
export function SyncStatusIcon({ sync, width, className = "", style }: SyncStatusIconProps) {
  const moving = sync.motion !== "none";
  const layer = "col-start-1 row-start-1 transition-opacity duration-200";
  return (
    <span
      data-motion={sync.motion}
      data-status={sync.status}
      className={`inline-grid shrink-0 place-items-center ${className}`}
      style={{ width, height: width, ...style }}
    >
      <Icon icon={syncStatusIcon(sync.resting)} width={width} className={`${layer} ${moving ? "opacity-0" : ""}`} />
      <span aria-hidden className={`${layer} ${moving ? "" : "opacity-0"}`}>
        {sync.motion === "arc" ? (
          <span
            data-arc
            className="block"
            style={{ animation: `spin ${ARC_TURN_MS}ms linear infinite` }}
            onAnimationIteration={sync.endTurn}
          >
            <Icon icon="lucide:loader-circle" width={width} className="block" />
          </span>
        ) : (
          <span className={`block ${sync.motion === "breathe" ? "animate-sync-breathe" : ""}`}>
            <Icon icon="lucide:cloud" width={width} className="block" />
          </span>
        )}
      </span>
    </span>
  );
}
