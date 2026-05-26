import type { StepConfig } from "./types";

export const SSH_STEPS: StepConfig[] = [
  { id: "tcp_connected", label: "TCP connection" },
  { id: "handshake", label: "SSH handshake" },
  { id: "authenticating", label: "Authenticating" },
  { id: "opening_shell", label: "Opening shell" },
];

export const SFTP_STEPS: StepConfig[] = [
  { id: "tcp_connected", label: "TCP connection" },
  { id: "handshake", label: "SSH handshake" },
  { id: "authenticating", label: "Authenticating" },
  { id: "sftp_subsystem", label: "SFTP subsystem" },
];

export const SERIAL_STEPS: StepConfig[] = [
  { id: "open_port", label: "Opening port" },
  { id: "ready", label: "Ready" },
];
