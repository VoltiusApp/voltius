import type { ReactNode } from "react";
import type { KnownHost } from "@/types";

export type StepStatus = "pending" | "active" | "done" | "error";

export interface StepConfig {
  id: string;
  label: string;
}

export interface Step extends StepConfig {
  status: StepStatus;
  detail?: string;
}

export interface StepEvent {
  step: string;
  detail: string;
}

export interface HostKeyConflictEvent {
  session_id: string;
  host: string;
  port: number;
  stored_entries: KnownHost[];
  new_fingerprint: string;
}

export type HostKeyConflictAction = "add_new" | "replace" | "abort";

export interface ConnectionOverlayProps {
  sessionId: string;
  status: "connecting" | "connected" | "error" | "disconnected";
  errorMessage?: string;
  name: string;
  subtitle?: string;
  icon: string;
  steps: readonly StepConfig[];
  stepEventName: string;
  conflictEventName?: string;
  className?: string;
  onDismiss?: () => void;
  onRetry?: () => void;
  onRetryWithPassphrase?: (passphrase: string, save: boolean) => void;
}

export interface DecisionPanelAction {
  label: string;
  variant?: "primary" | "secondary" | "ghost";
  disabled?: boolean;
  onClick?: () => void;
}

export interface DecisionPanelProps {
  tone: "warning" | "secure";
  icon: ReactNode;
  title: string;
  description: ReactNode;
  children?: ReactNode;
  actions: DecisionPanelAction[];
}
