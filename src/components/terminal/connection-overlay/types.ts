import type { IdentityPickIssue } from "@/services/credentialPlan";
import type { ReactNode } from "react";
import type { ConnectRetryOverride, KnownHost, TerminalSession } from "@/types";
import type { BackendErrorCode } from "@/services/backendErrors";

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
  /** Set when the vault, not the host, is why it failed. Outranks errorMessage. */
  errorCode?: BackendErrorCode;
  name: string;
  subtitle?: string;
  icon: string;
  /** Vault the connection belongs to — scopes the identity/key pickers shown in the auth prompt. */
  vaultId?: string;
  connectionId?: string;
  steps: readonly StepConfig[];
  stepEventName: string;
  conflictEventName?: string;
  className?: string;
  onDismiss?: () => void;
  onRetry?: () => void;
  reconnectWait?: TerminalSession["reconnectWait"];
  /** Cut the auto-reconnect loop's wait short. */
  onRetryNow?: () => void;
  onRetryWithPassphrase?: (passphrase: string, save: boolean) => void;
  /** Retry the connection with auth/username supplied through the overlay. */
  onRetryWithAuth?: (override: ConnectRetryOverride, save: boolean) => void;
  identityPick?: IdentityPickIssue;
  onUseHostCredential?: () => void;
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
