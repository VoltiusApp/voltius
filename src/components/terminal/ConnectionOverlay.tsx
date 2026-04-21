import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Icon } from "@iconify/react";
import type { KnownHost } from "@/types";
import { resolveKnownHostConflict } from "@/services/knownHosts";

type StepStatus = "pending" | "active" | "done" | "error";

interface StepConfig {
  id: string;
  label: string;
}

interface Step extends StepConfig {
  status: StepStatus;
  detail?: string;
}

interface StepEvent {
  step: string;
  detail: string;
}

interface HostKeyConflictEvent {
  session_id: string;
  host: string;
  port: number;
  stored_entries: KnownHost[];
  new_fingerprint: string;
}

export interface ConnectionOverlayProps {
  sessionId: string;
  status: "connecting" | "connected" | "error" | "disconnected";
  errorMessage?: string;
  name: string;
  subtitle?: string;
  icon: string;
  steps: readonly StepConfig[];
  stepEventName: string;
  conflictEventName: string;
  className?: string;
  onDismiss?: () => void;
  onRetry?: () => void;
}

export const SSH_STEPS: StepConfig[] = [
  { id: "tcp_connected",  label: "TCP connection" },
  { id: "handshake",      label: "SSH handshake" },
  { id: "authenticating", label: "Authenticating" },
  { id: "opening_shell",  label: "Opening shell" },
];

export const SFTP_STEPS: StepConfig[] = [
  { id: "tcp_connected",  label: "TCP connection" },
  { id: "handshake",      label: "SSH handshake" },
  { id: "authenticating", label: "Authenticating" },
  { id: "sftp_subsystem", label: "SFTP subsystem" },
];

export default function ConnectionOverlay({
  sessionId, status, errorMessage,
  name, subtitle, icon,
  steps: stepConfigs, stepEventName, conflictEventName,
  className,
  onDismiss, onRetry,
}: ConnectionOverlayProps) {
  const toSteps = (): Step[] => stepConfigs.map((s) => ({ ...s, status: "pending" as StepStatus }));

  const [steps, setSteps] = useState<Step[]>(toSteps);
  const [visible, setVisible] = useState(true);
  const [conflict, setConflict] = useState<HostKeyConflictEvent | null>(null);
  const [resolving, setResolving] = useState(false);
  const lastActivatedRef = useRef<string | null>(null);

  const activateStep = (id: string, detail?: string) => {
    lastActivatedRef.current = id;
    const ids = stepConfigs.map((s) => s.id);
    const currentIdx = ids.indexOf(id);
    setSteps((prev) =>
      prev.map((s) => {
        const sIdx = ids.indexOf(s.id);
        if (sIdx < currentIdx) return { ...s, status: "done" };
        if (s.id === id) return { ...s, status: "active", detail };
        return s;
      }),
    );
  };

  useEffect(() => {
    const unlisten = listen<StepEvent>(stepEventName, (e) =>
      activateStep(e.payload.step, e.payload.detail),
    );
    return () => { unlisten.then((fn) => fn()); };
  }, [stepEventName]);

  useEffect(() => {
    const unlisten = listen<HostKeyConflictEvent>(conflictEventName, (e) =>
      setConflict(e.payload),
    );
    return () => { unlisten.then((fn) => fn()); };
  }, [conflictEventName]);

  useEffect(() => {
    if (status === "connecting") {
      setSteps(toSteps());
      setConflict(null);
      setVisible(true);
      lastActivatedRef.current = null;
      return;
    }
    if (status === "connected") {
      setSteps((prev) => prev.map((s) => ({ ...s, status: "done" })));
      const t = setTimeout(() => setVisible(false), 300);
      return () => clearTimeout(t);
    }
    if (status === "error") {
      setConflict(null);
      const lastId = lastActivatedRef.current;
      setSteps((prev) => {
        const activeIdx = prev.findIndex((s) => s.status === "active");
        if (activeIdx !== -1) return prev.map((s, i) => i === activeIdx ? { ...s, status: "error" } : s);
        if (lastId) return prev.map((s) => s.id === lastId ? { ...s, status: "error" } : s);
        return prev.map((s, i) => i === 0 ? { ...s, status: "error" } : s);
      });
    }
  }, [status]);

  if (!visible) return null;

  const isError = status === "error";
  const isDisconnected = status === "disconnected";
  const isConnecting = status === "connecting";

  const handleResolve = async (action: "add_new" | "replace" | "abort") => {
    if (resolving) return;
    setResolving(true);
    try {
      await resolveKnownHostConflict(sessionId, action);
    } finally {
      setConflict(null);
      setResolving(false);
    }
  };

  return (
    <div className={className ?? "absolute inset-0 z-20 flex items-center justify-center bg-[var(--t-bg-terminal)]"}>
      <div className="flex flex-col items-center gap-6 w-80 text-center">

        <div className="relative">
          <div className="w-14 h-14 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center">
            <Icon icon={icon} width={22} className="text-accent" />
          </div>
          {isConnecting && !conflict && (
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none"
              viewBox="0 0 56 56"
            >
              <rect x="0.5" y="0.5" width="55" height="55" rx="16" ry="16"
                fill="none" stroke="#6366f1" strokeWidth="1.5"
                strokeDasharray="48 145"
                strokeLinecap="round"
                style={{ animation: "border-trace 0.8s linear infinite" }}
              />
            </svg>
          )}
        </div>

        <div>
          <p className="text-text-primary font-medium text-base leading-tight">{name}</p>
          {subtitle && <p className="text-text-muted text-xs mt-1">{subtitle}</p>}
        </div>

        {conflict && !isError ? (
          <HostKeyConflictPanel conflict={conflict} resolving={resolving} onResolve={handleResolve} />
        ) : (
          <>
            <div className="w-full space-y-2.5 text-left">
              {steps.map((step) => (
                <div
                  key={step.id}
                  className={`flex items-center gap-3 transition-opacity duration-200 ${
                    step.status === "pending" ? "opacity-25" : "opacity-100"
                  }`}
                >
                  <StepIcon status={step.status} />
                  <div className="min-w-0">
                    <span className={`text-sm ${
                      step.status === "done"   ? "text-text-secondary" :
                      step.status === "error"  ? "text-status-error"   :
                      step.status === "active" ? "text-text-primary"   :
                      "text-text-muted"
                    }`}>
                      {step.label}
                    </span>
                    {step.detail && step.status !== "pending" && (
                      <p className="text-text-muted text-xs truncate">{step.detail}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {isDisconnected && (
              <div className="w-full p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-center">
                <p className="text-yellow-400 text-sm font-medium">Connection lost</p>
                <p className="text-text-muted text-xs mt-1">Reconnecting…</p>
              </div>
            )}

            {isError && (
              <div className="w-full p-3 rounded-lg bg-red-600/10 border border-red-600/20">
                <p className="text-status-error text-sm font-medium">Connection failed</p>
                {errorMessage && (
                  <p className="text-status-error/80 text-xs mt-1 break-words">{errorMessage}</p>
                )}
                <div className="mt-2 flex items-center gap-3 justify-center">
                  {onRetry && (
                    <button
                      onClick={onRetry}
                      className="text-xs text-accent hover:text-accent/80 transition-colors underline"
                    >
                      Retry
                    </button>
                  )}
                  <button
                    onClick={onDismiss}
                    className="text-xs text-text-muted hover:text-text-primary transition-colors underline"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "done") {
    return (
      <div className="w-5 h-5 rounded-full bg-status-online/15 flex items-center justify-center shrink-0">
        <svg width="9" height="9" viewBox="0 0 10 8" fill="none" stroke="#22c55e" strokeWidth="2">
          <polyline points="1,4 4,7 9,1" />
        </svg>
      </div>
    );
  }
  if (status === "active") {
    return <div className="w-5 h-5 rounded-full border-2 border-accent/30 border-t-accent shrink-0 animate-spin" />;
  }
  if (status === "error") {
    return (
      <div className="w-5 h-5 rounded-full bg-status-error/15 flex items-center justify-center shrink-0">
        <svg width="9" height="9" viewBox="0 0 10 10" stroke="#ef4444" strokeWidth="2">
          <line x1="2" y1="2" x2="8" y2="8" /><line x1="8" y1="2" x2="2" y2="8" />
        </svg>
      </div>
    );
  }
  return <div className="w-5 h-5 rounded-full border border-border/50 shrink-0" />;
}

function truncateFp(fp: string): string {
  const colonIdx = fp.indexOf(":");
  if (colonIdx !== -1) {
    const algo = fp.slice(0, colonIdx + 1);
    const hash = fp.slice(colonIdx + 1);
    return algo + (hash.length > 20 ? hash.slice(0, 20) + "…" : hash);
  }
  return fp.length > 26 ? fp.slice(0, 26) + "…" : fp;
}

function HostKeyConflictPanel({
  conflict, resolving, onResolve,
}: {
  conflict: HostKeyConflictEvent;
  resolving: boolean;
  onResolve: (action: "add_new" | "replace" | "abort") => void;
}) {
  return (
    <div className="w-full flex flex-col gap-4">
      <div className="w-full p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-left">
        <div className="flex items-center gap-2 mb-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#eab308" strokeWidth="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span className="text-yellow-400 text-xs font-semibold tracking-wide">HOST KEY CHANGED</span>
        </div>
        <p className="text-text-secondary text-xs">
          The fingerprint for <span className="font-mono text-text-primary">{conflict.host}:{conflict.port}</span> has changed.
        </p>
      </div>

      <div className="w-full space-y-2 text-left">
        {conflict.stored_entries.slice(0, 2).map((entry) => (
          <div key={entry.id} className="p-2 rounded bg-[var(--t-bg-elevated)]">
            <p className="text-[var(--t-text-dim)] text-xs mb-0.5">Stored</p>
            <p className="font-mono text-xs text-text-secondary break-all">{truncateFp(entry.fingerprint)}</p>
          </div>
        ))}
        <div className="p-2 rounded bg-yellow-500/5 border border-yellow-500/20">
          <p className="text-yellow-400 text-xs mb-0.5">Received</p>
          <p className="font-mono text-xs text-text-secondary break-all">{truncateFp(conflict.new_fingerprint)}</p>
        </div>
      </div>

      <div className="w-full flex flex-col gap-2">
        <button
          disabled={resolving}
          onClick={() => onResolve("replace")}
          className="w-full px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent/80 transition-colors disabled:opacity-50"
        >
          Replace
        </button>
        <button
          disabled={resolving}
          onClick={() => onResolve("add_new")}
          className="w-full px-4 py-2 rounded-lg text-sm font-medium bg-[var(--t-bg-elevated)] text-text-primary border border-[var(--t-border)] hover:bg-[var(--t-bg-card-hover)] transition-colors disabled:opacity-50"
        >
          Add as new
        </button>
        <button
          disabled={resolving}
          onClick={() => onResolve("abort")}
          className="w-full px-4 py-2 rounded-lg text-sm text-text-muted hover:text-text-primary transition-colors disabled:opacity-50"
        >
          Abort
        </button>
      </div>
    </div>
  );
}
