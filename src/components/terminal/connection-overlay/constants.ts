import i18n from "@/i18n";
import type { StepConfig } from "./types";

// Labels are resolved at call time (not module load) so they reflect the
// active language; the `id`s are matched by value elsewhere (hooks.ts,
// utils.ts) and must stay untranslated.
export function getSshSteps(): StepConfig[] {
  return [
    { id: "tcp_connected", label: i18n.t("terminal.overlay.steps.tcpConnection") },
    { id: "handshake", label: i18n.t("terminal.overlay.steps.sshHandshake") },
    { id: "authenticating", label: i18n.t("terminal.overlay.steps.authenticating") },
    { id: "opening_shell", label: i18n.t("terminal.overlay.steps.openingShell") },
  ];
}

export function getSftpSteps(): StepConfig[] {
  return [
    { id: "tcp_connected", label: i18n.t("terminal.overlay.steps.tcpConnection") },
    { id: "handshake", label: i18n.t("terminal.overlay.steps.sshHandshake") },
    { id: "authenticating", label: i18n.t("terminal.overlay.steps.authenticating") },
    { id: "sftp_subsystem", label: i18n.t("terminal.overlay.steps.sftpSubsystem") },
  ];
}

export function getSerialSteps(): StepConfig[] {
  return [
    { id: "open_port", label: i18n.t("terminal.overlay.steps.openingPort") },
    { id: "ready", label: i18n.t("terminal.overlay.steps.ready") },
  ];
}
