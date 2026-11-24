import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@/lib/invoke";

export interface TmuxCopy {
  version: string;
  sessions: number;
}

export interface TmuxHostStatus {
  supported: boolean;
  system: string | null;
  active: string | null;
  copies: TmuxCopy[];
  outdated: boolean;
  systemControlCapable: boolean;
}

export type TmuxInstallStep = "download" | "upload" | "verify" | "link" | "done";

export interface TmuxInstallProgress {
  step: TmuxInstallStep;
  progress: number;
}

/** What an install rejection means, named as its `notifications.tmux.failed.*` message. */
export type TmuxInstallFailure =
  | "download"
  | "checksum"
  | "noSha256"
  | "version"
  | "unsupported"
  | "inside"
  | "newer"
  | "cancelled"
  | "other";

/** Keyed by Rust's `tmux_install` error strings. */
const FAILURES = new Map<unknown, TmuxInstallFailure>([
  ["download", "download"],
  ["checksum", "checksum"],
  ["no-sha256", "noSha256"],
  ["version", "version"],
  ["unsupported", "unsupported"],
  ["inside", "inside"],
  ["newer", "newer"],
  ["cancelled", "cancelled"],
]);

export function tmuxFailure(e: unknown): TmuxInstallFailure {
  return FAILURES.get(e) ?? "other";
}

export const tmuxStatus = (sessionId: string) => invoke<TmuxHostStatus>("ssh_tmux_status", { sessionId });

export const tmuxRemove = (sessionId: string) => invoke<TmuxHostStatus>("ssh_tmux_remove", { sessionId });

export const tmuxPrune = (sessionId: string) => invoke<TmuxHostStatus>("ssh_tmux_prune", { sessionId });

export function tmuxInstall(
  sessionId: string,
  onProgress: (p: TmuxInstallProgress) => void,
): { promise: Promise<TmuxHostStatus>; cancel(): void } {
  const installId = crypto.randomUUID();
  // Listen before starting: the first steps of a fast install would otherwise be lost.
  const promise = listen<TmuxInstallProgress>(`tmux-install-${installId}`, ({ payload }) => onProgress(payload)).then(
    async (unlisten) => {
      try {
        return await invoke<TmuxHostStatus>("ssh_tmux_install", { sessionId, installId });
      } finally {
        unlisten();
      }
    },
  );
  return { promise, cancel: () => void invoke("ssh_tmux_cancel", { installId }).catch(() => {}) };
}

let pinVersion: Promise<string> | undefined;

export function tmuxPinVersion(): Promise<string> {
  pinVersion ??= invoke<string>("ssh_tmux_pin_version").catch((e) => {
    pinVersion = undefined;
    throw e;
  });
  return pinVersion;
}

export function useTmuxPinVersion(): string | undefined {
  const [version, setVersion] = useState<string>();
  useEffect(() => {
    let live = true;
    tmuxPinVersion().then(
      (v) => {
        if (live) setVersion(v);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, []);
  return version;
}
