import { create } from "zustand";
import i18n from "@/i18n";
import { invoke } from "@tauri-apps/api/core";
import { sftpClose, sftpCanonicalize, sftpOpen, fsHomeDir } from "@/services/sftp";
import type { TerminalSession } from "@/types";

// Per-session SFTP connection state for the right-panel SFTP tab. Independent
// of SFTPPage's own connections so opening the panel never disturbs an
// in-progress SFTPPage transfer (and vice versa).
//
// Lifecycle: opened lazily when the tab first views a session; closed when
// the owning session is disconnected or removed (wired in sessionStore).

export type PanelSftpState =
  | { tag: "idle" }
  | { tag: "connecting" }
  | { tag: "connected"; sftpId: string | null; isLocal: boolean; cwd: string; followCwd: boolean }
  | { tag: "error"; message: string };

interface PanelSftpStore {
  sessions: Record<string, PanelSftpState>;
  ensureConnected: (session: TerminalSession) => Promise<void>;
  setCwd: (sessionId: string, cwd: string) => void;
  setFollowCwd: (sessionId: string, follow: boolean) => void;
  closeSession: (sessionId: string) => void;
}

export const usePanelSftpStore = create<PanelSftpStore>((set, get) => ({
  sessions: {},

  ensureConnected: async (session) => {
    const existing = get().sessions[session.id];
    if (existing && (existing.tag === "connecting" || existing.tag === "connected")) return;

    set((s) => ({ sessions: { ...s.sessions, [session.id]: { tag: "connecting" } } }));

    try {
      if (session.type === "local") {
        const cwd = await fsHomeDir();
        set((s) => ({
          sessions: { ...s.sessions, [session.id]: { tag: "connected", sftpId: null, isLocal: true, cwd, followCwd: true } },
        }));
        return;
      }

      if (session.type !== "ssh") {
        set((s) => ({ sessions: { ...s.sessions, [session.id]: { tag: "error", message: i18n.t("terminal.sftp.notSupportedForSessionType") } } }));
        return;
      }

      // Container exec sessions (docker exec / pct enter): run sftp-server inside the container.
      if (session.containerExec) {
        const { kind, parentSessionId } = session.containerExec;
        let sftpId: string;
        if (kind === "docker") {
          sftpId = await invoke<string>("docker_sftp_open", {
            sessionId: parentSessionId,
            containerId: session.containerExec.containerId,
          });
        } else {
          sftpId = await invoke<string>("proxmox_lxc_sftp_open", {
            sessionId: parentSessionId,
            vmid: session.containerExec.vmid,
          });
        }
        const cwd = await sftpCanonicalize(sftpId, ".");
        set((s) => ({
          sessions: { ...s.sessions, [session.id]: { tag: "connected", sftpId, isLocal: false, cwd, followCwd: true } },
        }));
        return;
      }

      // Ride the terminal's already-authenticated SSH connection. Dialing a
      // second one for saved connections cost an extra auth and, worse, gave the
      // panel a handle nothing swaps on reconnect (sftp/mod.rs own_cell): after
      // a sleep the terminal came back while the panel stayed pinned to the dead
      // link, failing every operation with "Channel send error" until restart.
      // sftp_open hands over the session's live handle cell instead.
      const sftpId = await sftpOpen(session.id);
      const cwd = await sftpCanonicalize(sftpId, ".");
      set((s) => ({
        sessions: { ...s.sessions, [session.id]: { tag: "connected", sftpId, isLocal: false, cwd, followCwd: true } },
      }));
    } catch (e) {
      set((s) => ({ sessions: { ...s.sessions, [session.id]: { tag: "error", message: String(e) } } }));
    }
  },

  setCwd: (sessionId, cwd) =>
    set((s) => {
      const cur = s.sessions[sessionId];
      if (!cur || cur.tag !== "connected" || cur.cwd === cwd) return s;
      return { sessions: { ...s.sessions, [sessionId]: { ...cur, cwd } } };
    }),

  setFollowCwd: (sessionId, follow) =>
    set((s) => {
      const cur = s.sessions[sessionId];
      if (!cur || cur.tag !== "connected" || cur.followCwd === follow) return s;
      return { sessions: { ...s.sessions, [sessionId]: { ...cur, followCwd: follow } } };
    }),

  closeSession: (sessionId) => {
    const cur = get().sessions[sessionId];
    if (cur?.tag === "connected" && cur.sftpId) {
      sftpClose(cur.sftpId).catch(() => {});
    }
    set((s) => {
      if (!(sessionId in s.sessions)) return s;
      const next = { ...s.sessions };
      delete next[sessionId];
      return { sessions: next };
    });
  },
}));
