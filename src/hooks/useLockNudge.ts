import { useCallback, useEffect, useRef, useState } from "react";
import { useLockNudgeStore } from "@/stores/lockNudgeStore";

export interface LockNudgeCue {
  active: boolean;
  /** Key the animated element on this so every matching nudge restarts the animation. */
  key: number;
  end: () => void;
}

export function useLockNudge(sessionIds: string[], enabled = true): LockNudgeCue {
  const nonce = useLockNudgeStore((s) => s.nonce);
  const [cue, setCue] = useState({ active: false, key: 0 });
  const seen = useRef(nonce);
  useEffect(() => {
    if (nonce === seen.current) return;
    seen.current = nonce;
    if (enabled && useLockNudgeStore.getState().ids.some((id) => sessionIds.includes(id))) setCue({ active: true, key: nonce });
  }, [nonce, enabled, sessionIds]);
  const end = useCallback(() => setCue((c) => ({ ...c, active: false })), []);
  return { ...cue, end };
}
