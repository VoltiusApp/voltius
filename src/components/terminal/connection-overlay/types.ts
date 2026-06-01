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

/**
 * Auth/username supplied through the connection overlay when a host is missing
 * credentials. Mirrors the choices available in the connection form: an existing
 * keychain identity, an existing key, or inline password / private key material.
 * Any field left undefined is resolved from the host's stored config instead.
 */
export interface ConnectRetryOverride {
  username?: string;
  identityId?: string | null;
  keyId?: string | null;
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

export interface ConnectionOverlayProps {
  sessionId: string;
  status: "connecting" | "connected" | "error" | "disconnected";
  errorMessage?: string;
  name: string;
  subtitle?: string;
  icon: string;
  /** Vault the connection belongs to — scopes the identity/key pickers shown in the auth prompt. */
  vaultId?: string;
  steps: readonly StepConfig[];
  stepEventName: string;
  conflictEventName?: string;
  className?: string;
  onDismiss?: () => void;
  onRetry?: () => void;
  onRetryWithPassphrase?: (passphrase: string, save: boolean) => void;
  /** Retry the connection with auth/username supplied through the overlay. */
  onRetryWithAuth?: (override: ConnectRetryOverride, save: boolean) => void;
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
