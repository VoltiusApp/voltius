import i18n from "@/i18n";
import { logFailure } from "@/lib/logger";
import { describeError } from "@/services/backendErrors";
import type { MuxModeEvent } from "@/services/ssh";
import { tmuxFailure, tmuxInstall, tmuxPinVersion, tmuxPrune, tmuxStatus, type TmuxHostStatus } from "@/services/tmuxInstall";
import { muxFromMode, needsNotify, useHostMuxStore, type TmuxInstalling } from "@/stores/hostMuxStore";
import { APP_SOURCE, useNotificationStore, type ToastEntry, type ToastHost } from "@/stores/notificationStore";
import { useSessionStore } from "@/stores/sessionStore";
import { getToggle } from "@/stores/toggleSettingsStore";
import type { TerminalSession } from "@/types";
import { notifyError } from "@/utils/notifyError";
import { progressToaster } from "@/utils/progressToaster";

const INSTALLED_MS = 10_000;
const NOTICE_MS = 5_000;
const CHECKSUM_MS = 10_000;

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
const failedUpdates = new Set<string>();

const updateKey = (connectionId: string, pin: string) => `${connectionId}@${pin}`;

export function tmuxOnConnect(sessionId: string, connectionId: string, hostName: string, mode: MuxModeEvent): void {
  const seen = muxFromMode(mode);
  if (!seen) return;
  const mux = useHostMuxStore.getState();
  const wasUnsupported = mux.hosts[connectionId]?.kind === "unsupported";
  mux.record(connectionId, seen);
  if (checking.has(connectionId)) return;
  checking.add(connectionId);
  void checkHost(sessionId, connectionId, hostName, wasUnsupported)
    .catch(logFailure(`tmux check on ${hostName}`))
    .finally(() => checking.delete(connectionId));
}

async function checkHost(sessionId: string, connectionId: string, hostName: string, wasUnsupported: boolean): Promise<void> {
  const status = await tmuxStatus(sessionId).catch(() => undefined);
  if (status) applyTmuxStatus(connectionId, status);
  const unsupported = status ? !status.supported : wasUnsupported;
  if (unsupported && useHostMuxStore.getState().hosts[connectionId]?.kind !== "tmux-cc") {
    useHostMuxStore.getState().record(connectionId, { kind: "unsupported" });
  }
  offerInstall(sessionId, connectionId, hostName, status);
  if (!status?.supported || !status.active) return;
  if (status.outdated && getToggle("tmux-auto-update") && !failedUpdates.has(updateKey(connectionId, await tmuxPinVersion()))) {
    await runInstall(sessionId, connectionId, hostName, true);
  } else {
    await pruneIdle(sessionId, connectionId, status);
  }
}

function offerInstall(sessionId: string, connectionId: string, hostName: string, status: TmuxHostStatus | undefined): void {
  const host = useHostMuxStore.getState().hosts[connectionId];
  if (!host || !needsNotify(host)) return;
  // A re-attached screen or old-tmux session predates whatever tmux the host has now.
  if (status?.active || status?.systemControlCapable) return;
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
        const live = liveSession(connectionId, sessionId);
        if (!live) return hostToast(connectionId, hostName, "info", i18n.t("notifications.tmux.connectFirst"));
        notices.dismissToast(id);
        startTmuxInstall(live, connectionId, hostName);
      },
    },
  });
}

function hostToast(connectionId: string, hostName: string, severity: ToastEntry["severity"], message: string, duration = NOTICE_MS): void {
  useNotificationStore.getState().addToast({ source: APP_SOURCE, host: { connectionId, name: hostName }, type: "toast", severity, duration, message });
}

function liveSession(connectionId: string, preferred: string): string | undefined {
  const live = useSessionStore
    .getState()
    .sessions.filter((s) => s.connectionId === connectionId && s.status === "connected" && isPlainSsh(s));
  return (live.find((s) => s.id === preferred) ?? live[0])?.id;
}

async function pruneIdle(sessionId: string, connectionId: string, status: TmuxHostStatus): Promise<void> {
  if (!status.copies.some((c) => c.version !== status.active && c.sessions === 0)) return;
  applyTmuxStatus(connectionId, await tmuxPrune(sessionId));
}

export function startTmuxInstall(sessionId: string, connectionId: string, hostName: string): void {
  void runInstall(sessionId, connectionId, hostName, false);
}

async function runInstall(sessionId: string, connectionId: string, hostName: string, quiet: boolean): Promise<void> {
  const mux = useHostMuxStore.getState();
  const running = mux.installing[connectionId];
  if (running) {
    if (!quiet && running.quiet) mux.setInstalling(connectionId, { ...running, quiet: false });
    return;
  }
  const current = (): TmuxInstalling | undefined => useHostMuxStore.getState().installing[connectionId];
  mux.setInstalling(connectionId, { step: "download", progress: 0, quiet });
  mux.setFailure(connectionId, undefined);
  const t = i18n.t;
  const host: ToastHost = { connectionId, name: hostName };
  const toast = progressToaster({ host });
  const finish = (fields: Parameters<typeof toast.show>[0]) =>
    toast.show({ finished: true, cancellable: false, onCancel: undefined, ...fields });
  let pin = "";
  let cancel = () => {};
  let shown: TmuxInstalling | undefined;
  let unsubscribe = () => {};
  const render = (state: TmuxInstalling | undefined) => {
    if (!state || state.quiet || state === shown) return;
    shown = state;
    const step = t(`notifications.tmux.step.${state.step}`);
    toast.show({ message: t("notifications.tmux.installing", { version: pin, step }), progress: state.progress, cancellable: true, onCancel: () => cancel() });
  };
  try {
    pin = await tmuxPinVersion();
    const job = tmuxInstall(sessionId, ({ step, progress }) => {
      const state = current();
      if (state) useHostMuxStore.getState().setInstalling(connectionId, { ...state, step, progress });
    });
    cancel = job.cancel;
    unsubscribe = useHostMuxStore.subscribe((s) => render(s.installing[connectionId]));
    render(current());
    const status = await job.promise;
    const visible = !current()?.quiet;
    applyTmuxStatus(connectionId, status);
    if (visible) {
      finish({
        finishedSeverity: "success",
        duration: INSTALLED_MS,
        message: t("notifications.tmux.installed", { version: pin }),
        action: {
          label: t("notifications.tmux.openNewTab"),
          onClick: () => {
            toast.dismiss();
            useSessionStore.getState().connect(connectionId).catch(notifyError);
          },
        },
      });
    } else {
      hostToast(connectionId, hostName, "success", t("notifications.tmux.updated", { version: pin, host: hostName }));
    }
    await pruneIdle(sessionId, connectionId, status).catch(logFailure(`tmux prune on ${hostName}`));
  } catch (e) {
    const failure = tmuxFailure(e);
    const visible = !current()?.quiet;
    if (quiet) failedUpdates.add(updateKey(connectionId, pin));
    if (failure === "cancelled") return toast.dismiss();
    useHostMuxStore.getState().setFailure(connectionId, failure);
    const message = t(`notifications.tmux.failed.${failure}`, { host: hostName });
    if (visible) {
      finish({
        finishedSeverity: "error",
        message,
        detail: failure === "other" ? describeError(e, t) : undefined,
      });
    } else {
      logFailure(`tmux update on ${hostName}`)(e);
      // A checksum mismatch may mean tampering, so it is shown even for a background update.
      if (failure === "checksum") hostToast(connectionId, hostName, "error", message, CHECKSUM_MS);
    }
  } finally {
    unsubscribe();
    useHostMuxStore.getState().setInstalling(connectionId, undefined);
  }
}
