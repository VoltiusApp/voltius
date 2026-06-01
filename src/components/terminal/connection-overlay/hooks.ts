import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { resolveKnownHostConflict } from "@/services/knownHosts";
import type {
  HostKeyConflictAction,
  HostKeyConflictEvent,
  Step,
  StepConfig,
  StepEvent,
} from "./types";
import { activateStep, createSteps, markErrorStep } from "./utils";

export function useConnectionSteps({
  status,
  stepConfigs,
  stepEventName,
}: {
  status: "connecting" | "connected" | "error" | "disconnected";
  stepConfigs: readonly StepConfig[];
  stepEventName: string;
}): { steps: Step[]; visible: boolean } {
  const [steps, setSteps] = useState<Step[]>(() => createSteps(stepConfigs));
  const [visible, setVisible] = useState(true);
  const lastActivatedRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const unlisten = listen<StepEvent>(stepEventName, (event) => {
      if (cancelled) return;
      lastActivatedRef.current = event.payload.step;
      setSteps((currentSteps) => activateStep(
        currentSteps,
        stepConfigs,
        event.payload.step,
        event.payload.detail,
      ));
    });

    return () => {
      cancelled = true;
      void unlisten.then((fn) => fn());
    };
  }, [stepEventName, stepConfigs]);

  useEffect(() => {
    if (status === "connecting") {
      setSteps(createSteps(stepConfigs));
      setVisible(true);
      lastActivatedRef.current = null;
      return;
    }
    if (status === "connected") {
      setSteps((currentSteps) => currentSteps.map((step) => ({ ...step, status: "done" })));
      const timer = setTimeout(() => setVisible(false), 300);
      return () => clearTimeout(timer);
    }
    if (status === "error") {
      setSteps((currentSteps) => markErrorStep(currentSteps, lastActivatedRef.current));
    }
  }, [status, stepConfigs]);

  return { steps, visible };
}

export function useHostKeyConflict({
  sessionId,
  status,
  conflictEventName,
}: {
  sessionId: string;
  status: "connecting" | "connected" | "error" | "disconnected";
  conflictEventName?: string;
}): {
  conflict: HostKeyConflictEvent | null;
  resolving: boolean;
  resolveConflict: (action: HostKeyConflictAction) => Promise<void>;
} {
  const [conflict, setConflict] = useState<HostKeyConflictEvent | null>(null);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    if (!conflictEventName) return;

    let cancelled = false;
    const unlisten = listen<HostKeyConflictEvent>(conflictEventName, (event) => {
      if (cancelled || event.payload.session_id !== sessionId) return;
      setConflict(event.payload);
    });

    return () => {
      cancelled = true;
      void unlisten.then((fn) => fn());
    };
  }, [conflictEventName, sessionId]);

  useEffect(() => {
    if (status === "connecting" || status === "error") {
      setConflict(null);
    }
  }, [status]);

  async function resolveConflict(action: HostKeyConflictAction): Promise<void> {
    if (resolving) return;
    setResolving(true);
    try {
      await resolveKnownHostConflict(sessionId, action);
    } finally {
      setConflict(null);
      setResolving(false);
    }
  }

  return { conflict, resolving, resolveConflict };
}
