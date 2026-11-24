import i18n from "@/i18n";
import { logFailure } from "@/lib/logger";
import { describeError } from "@/services/backendErrors";
import type { MuxModeEvent } from "@/services/ssh";
import { tmuxFailure, tmuxInstall, tmuxPinVersion, tmuxPrune, tmuxStatus, type TmuxHostStatus, type TmuxInstallStep } from "@/services/tmuxInstall";
import { muxFromMode, needsNotify, useHostMuxStore } from "@/stores/hostMuxStore";
import { APP_SOURCE, useNotificationStore, type ToastHost } from "@/stores/notificationStore";
import { useSessionStore } from "@/stores/sessionStore";
import { getToggle } from "@/stores/toggleSettingsStore";
import type { TerminalSession } from "@/types";
import { notifyError } from "@/utils/notifyError";
import { progressToaster } from "@/utils/progressToaster";

const CONTROL_MODE_MIN = "3.2";
const INSTALLED_MS = 10_000;
const UPDATED_MS = 5_000;

const VERSION = /^(\d+)\.(\d+)([a-z]*)/;

/** False when either version is unreadable, so an odd build is never replaced. */
export function tmuxOlder(a: string, b: string): boolean {
  const x = VERSION.exec(a);
  const y = VERSION.exec(b);
  if (!x || !y) return false;
  const major = Number(x[1]) - Number(y[1]);
  if (major) return major < 0;
  const minor = Number(x[2]) - Number(y[2]);
  if (minor) return minor < 0;
  return x[3] < y[3];
}

/** A shell on the host itself: container and VM exec sessions cannot install there. */
export function isPlainSsh(session: TerminalSession | undefined): session is TerminalSession {
  return session?.type === "ssh" && !session.containerExec;
}

export function applyTmuxStatus(connectionId: string, status: TmuxHostStatus): void {
  const voltius = status.active
    ? {
        active: status.active,
        versions: status.copies.map((c) => c.version),
        inUse: Object.fromEntries(status.copies.map((c) => [c.version, c.sessions])),
      }
    : undefined;
  useHostMuxStore.getState().setVoltius(connectionId, voltius);
}

const checking = new Set<string>();
const installing = new Set<string>();

export function tmuxOnConnect(sessionId: string, connectionId: string, hostName: string, mode: MuxModeEvent): void {
  const seen = muxFromMode(mode);
  if (!seen) return;
  useHostMuxStore.getState().record(connectionId, seen);
  if (checking.has(connectionId)) return;
  checking.add(connectionId);
  void checkHost(sessionId, connectionId, hostName)
    .catch(logFailure(`tmux check on ${hostName}`))
    .finally(() => checking.delete(connectionId));
}

async function checkHost(sessionId: string, connectionId: string, hostName: string): Promise<void> {
  const status = await tmuxStatus(sessionId).catch(() => undefined);
  if (status) {
    applyTmuxStatus(connectionId, status);
    if (!status.supported && useHostMuxStore.getState().hosts[connectionId]?.kind !== "tmux-cc") {
      useHostMuxStore.getState().record(connectionId, { kind: "unsupported" });
    }
  }
  offerInstall(sessionId, connectionId, hostName, status);
  if (!status?.supported || !status.active) return;
  if (getToggle("tmux-auto-update") && tmuxOlder(status.active, await tmuxPinVersion())) {
    await runInstall(sessionId, connectionId, hostName, true);
  } else {
    await pruneIdle(sessionId, connectionId, status);
  }
}

function offerInstall(sessionId: string, connectionId: string, hostName: string, status: TmuxHostStatus | undefined): void {
  const host = useHostMuxStore.getState().hosts[connectionId];
  if (!host || !needsNotify(host)) return;
  // A re-attached screen or old-tmux session predates whatever tmux the host has now.
  if (status?.active || (status?.system && !tmuxOlder(status.system, CONTROL_MODE_MIN))) return;
  useHostMuxStore.getState().markNotified(connectionId, host.kind);
  const notices = useNotificationStore.getState();
  const notice = host.kind === "tmux-old" ? "old" : host.kind;
  const id = notices.addToast({
    source: APP_SOURCE,
    host: { connectionId, name: hostName },
    type: "toast",
    severity: "warning",
    duration: 0,
    message: i18n.t(`notifications.tmux.${notice}`, { host: hostName, version: host.version }),
    action: {
      label: i18n.t("notifications.tmux.install"),
      onClick: () => {
        notices.dismissToast(id);
        startTmuxInstall(liveSession(connectionId, sessionId), connectionId, hostName);
      },
    },
  });
}

function liveSession(connectionId: string, preferred: string): string {
  const live = useSessionStore
    .getState()
    .sessions.filter((s) => s.connectionId === connectionId && s.status === "connected" && isPlainSsh(s));
  return (live.find((s) => s.id === preferred) ?? live[0])?.id ?? preferred;
}

async function pruneIdle(sessionId: string, connectionId: string, status: TmuxHostStatus): Promise<void> {
  if (!status.copies.some((c) => c.version !== status.active && c.sessions === 0)) return;
  applyTmuxStatus(connectionId, await tmuxPrune(sessionId));
}

export function startTmuxInstall(sessionId: string, connectionId: string, hostName: string): void {
  void runInstall(sessionId, connectionId, hostName, false);
}

async function runInstall(sessionId: string, connectionId: string, hostName: string, quiet: boolean): Promise<void> {
  if (installing.has(connectionId)) return;
  installing.add(connectionId);
  const t = i18n.t;
  const host: ToastHost = { connectionId, name: hostName };
  const toast = quiet ? undefined : progressToaster({ host });
  try {
    const version = await tmuxPinVersion();
    const step = (s: TmuxInstallStep) => t("notifications.tmux.installing", { version, step: t(`notifications.tmux.step.${s}`) });
    const job = tmuxInstall(sessionId, (p) => toast?.update({ progress: p.progress, message: step(p.step) }));
    toast?.show({ message: step("download"), progress: 0, cancellable: true, onCancel: () => job.cancel() });
    const status = await job.promise;
    applyTmuxStatus(connectionId, status);
    if (toast) {
      toast.update({
        finished: true,
        finishedSeverity: "success",
        cancellable: false,
        onCancel: undefined,
        duration: INSTALLED_MS,
        message: t("notifications.tmux.installed", { version }),
        action: {
          label: t("notifications.tmux.openNewTab"),
          onClick: () => {
            if (toast.id) useNotificationStore.getState().dismissToast(toast.id);
            useSessionStore.getState().connect(connectionId).catch(notifyError);
          },
        },
      });
    } else {
      useNotificationStore.getState().addToast({
        source: APP_SOURCE,
        host,
        type: "toast",
        severity: "success",
        duration: UPDATED_MS,
        message: t("notifications.tmux.updated", { version, host: hostName }),
      });
    }
    await pruneIdle(sessionId, connectionId, status).catch(logFailure(`tmux prune on ${hostName}`));
  } catch (e) {
    const failure = tmuxFailure(e);
    if (!toast) return logFailure(`tmux update on ${hostName}`)(e);
    if (failure === "cancelled") {
      if (toast.id) useNotificationStore.getState().dismissToast(toast.id);
      return;
    }
    toast.show({
      finished: true,
      finishedSeverity: "error",
      cancellable: false,
      onCancel: undefined,
      message: t(`notifications.tmux.failed.${failure}`, { host: hostName }),
      detail: failure === "other" ? describeError(e, t) : undefined,
    });
  } finally {
    installing.delete(connectionId);
  }
}
