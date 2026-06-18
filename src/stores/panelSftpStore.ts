import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { sftpConnect, sftpClose, sftpCanonicalize, fsHomeDir } from "@/services/sftp";
import { resolveConnectionCredentials, resolveJumpHosts } from "@/services/credentials";
import { resolveKeepalive } from "@/utils/keepalive";
import { getGlobalKeepalivePreset } from "./connectivitySettingsStore";
import { genId } from "@/components/filetransfer/SFTPTypes";
import type { Connection, TerminalSession } from "@/types";
import { useConnectionStore } from "./connectionStore";

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

function findConnection(connectionId: string): Connection | undefined {
  const { connections, teamConnections } = useConnectionStore.getState();
  return (
    connections.find((c) => c.id === connectionId) ??
    Object.values(teamConnections).flat().find((c) => c.id === connectionId)
  );
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
        set((s) => ({ sessions: { ...s.sessions, [session.id]: { tag: "error", message: "SFTP not supported for this session type" } } }));
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

      const conn = findConnection(session.connectionId);
      if (!conn) {
        set((s) => ({ sessions: { ...s.sessions, [session.id]: { tag: "error", message: "Connection not found" } } }));
        return;
      }

      const [creds, jumpHosts] = await Promise.all([
        resolveConnectionCredentials(conn),
        resolveJumpHosts(conn),
      ]);
      const ka = resolveKeepalive(conn.keepalive_preset ?? getGlobalKeepalivePreset());
      const sftpId = await sftpConnect({
        connectId: genId(),
        host: conn.host, port: conn.port,
        username: creds.username, password: creds.password,
        privateKey: creds.privateKey, passphrase: creds.passphrase,
        jumpHosts: jumpHosts.length > 0 ? jumpHosts : undefined,
        keepaliveIntervalSecs: ka.intervalSecs, keepaliveMax: ka.max,
      });
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
