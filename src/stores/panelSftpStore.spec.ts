import { describe, it, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

const sftpOpen = vi.fn();
const sftpConnect = vi.fn();
const sftpCanonicalize = vi.fn();
const sftpClose = vi.fn();
const fsHomeDir = vi.fn();
vi.mock("@/services/sftp", () => ({
  sftpOpen: (...a: unknown[]) => sftpOpen(...a),
  sftpConnect: (...a: unknown[]) => sftpConnect(...a),
  sftpCanonicalize: (...a: unknown[]) => sftpCanonicalize(...a),
  sftpClose: (...a: unknown[]) => sftpClose(...a),
  fsHomeDir: (...a: unknown[]) => fsHomeDir(...a),
}));

import { usePanelSftpStore } from "./panelSftpStore";
import type { TerminalSession } from "@/types";

const sshSession = (over: Partial<TerminalSession> = {}): TerminalSession => ({
  id: "sess1", connectionId: "missing", connectionName: "x", status: "connected", type: "ssh", ...over,
});

describe("panelSftpStore.ensureConnected", () => {
  beforeEach(() => {
    usePanelSftpStore.setState({ sessions: {} });
    invoke.mockReset(); sftpOpen.mockReset(); sftpConnect.mockReset();
    sftpCanonicalize.mockReset(); fsHomeDir.mockReset();
  });

  it("rides the terminal session via sftp_open when no saved connection exists", async () => {
    sftpOpen.mockResolvedValue("sftp-1");
    sftpCanonicalize.mockResolvedValue("/home/u");
    await usePanelSftpStore.getState().ensureConnected(sshSession());
    expect(sftpOpen).toHaveBeenCalledWith("sess1");
    expect(sftpConnect).not.toHaveBeenCalled();
    const st = usePanelSftpStore.getState().sessions["sess1"];
    expect(st.tag === "connected" && st.sftpId).toBe("sftp-1");
    expect(st.tag === "connected" && st.isLocal).toBe(false);
  });

  // A second dial gave the panel a handle nothing swaps on reconnect, so it
  // stayed pinned to the dead link after a sleep while the terminal came back.
  it("rides the terminal session too when the session has a saved connection", async () => {
    sftpOpen.mockResolvedValue("sftp-2");
    sftpCanonicalize.mockResolvedValue("/home/u");
    await usePanelSftpStore.getState().ensureConnected(sshSession({ connectionId: "c1" }));
    expect(sftpOpen).toHaveBeenCalledWith("sess1");
    expect(sftpConnect).not.toHaveBeenCalled();
    const st = usePanelSftpStore.getState().sessions["sess1"];
    expect(st.tag === "connected" && st.sftpId).toBe("sftp-2");
  });
});
