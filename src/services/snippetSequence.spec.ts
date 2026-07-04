import { describe, it, expect, vi, beforeEach } from "vitest";

const sftpUpload = vi.fn(async (..._a: unknown[]) => {});
const sftpDownload = vi.fn(async (..._a: unknown[]) => {});
const sftpUploadDirTar = vi.fn(async (..._a: unknown[]) => {});
const sftpDownloadDirTar = vi.fn(async (..._a: unknown[]) => {});
const sftpClose = vi.fn(async (..._a: unknown[]) => {});
vi.mock("@/services/sftp", () => ({
  sftpUpload: (...a: unknown[]) => sftpUpload(...a),
  sftpDownload: (...a: unknown[]) => sftpDownload(...a),
  sftpUploadDirTar: (...a: unknown[]) => sftpUploadDirTar(...a),
  sftpDownloadDirTar: (...a: unknown[]) => sftpDownloadDirTar(...a),
  sftpClose: (...a: unknown[]) => sftpClose(...a),
}));
vi.mock("@/components/filetransfer/SFTPTypes", () => ({ genId: () => "tid" }));

const resolveSftpIdForTarget = vi.fn(async (..._a: unknown[]) => "fake-sftp-id");
vi.mock("@/services/sftpTarget", () => ({
  resolveSftpIdForTarget: (...a: unknown[]) => resolveSftpIdForTarget(...a),
}));

const readClipboard = vi.fn(async (..._a: unknown[]) => "PASTED");
vi.mock("@/utils/clipboard", () => ({ readClipboard: (...a: unknown[]) => readClipboard(...a) }));

import { runTransferStep, executeSequenceForTargets, runSnippetSequence, buildSummaryMessage, buildTargetContext, resolveTerminalTargets } from "./snippetSequence";
import type { SequenceRunResult } from "./snippetSequence";
import type { Connection, TerminalSession } from "@/types";
import type { Snippet } from "@/types";

function mkConn(over: Partial<Connection>): Connection {
  return {
    id: "c", host: "h", port: 22, username: "u", auth_type: "password",
    tags: [], created_at: "", last_used_at: null, vault_id: "personal", ...over,
  } as Connection;
}

function sess(over: Partial<TerminalSession>): TerminalSession {
  return { id: "s", connectionId: "c", connectionName: "n", status: "connected", type: "ssh", ...over } as TerminalSession;
}

const immediateSubscribe = () => () => {};

beforeEach(() => {
  sftpUpload.mockClear(); sftpDownload.mockClear(); sftpUploadDirTar.mockClear();
  sftpDownloadDirTar.mockClear(); sftpClose.mockClear(); resolveSftpIdForTarget.mockClear();
  readClipboard.mockClear();
});

describe("runTransferStep", () => {
  it("uploads a file", async () => {
    await runTransferStep("sid", { kind: "transfer", direction: "upload", local_path: "/l", remote_path: "/r", is_dir: false });
    expect(sftpUpload).toHaveBeenCalledWith({ sftpId: "sid", localPath: "/l", remotePath: "/r", transferId: "tid" });
  });

  it("downloads a directory via tar", async () => {
    await runTransferStep("sid", { kind: "transfer", direction: "download", local_path: "/l", remote_path: "/r", is_dir: true });
    expect(sftpDownloadDirTar).toHaveBeenCalledWith({ sftpId: "sid", localPath: "/l", remotePath: "/r", transferId: "tid" });
  });

  it("uploads a directory via tar and calls no sibling command", async () => {
    await runTransferStep("sid", { kind: "transfer", direction: "upload", local_path: "/l", remote_path: "/r", is_dir: true });
    expect(sftpUploadDirTar).toHaveBeenCalledWith({ sftpId: "sid", localPath: "/l", remotePath: "/r", transferId: "tid" });
    expect(sftpUpload).not.toHaveBeenCalled();
    expect(sftpDownload).not.toHaveBeenCalled();
    expect(sftpDownloadDirTar).not.toHaveBeenCalled();
  });

  it("downloads a file and calls no sibling command", async () => {
    await runTransferStep("sid", { kind: "transfer", direction: "download", local_path: "/l", remote_path: "/r", is_dir: false });
    expect(sftpDownload).toHaveBeenCalledWith({ sftpId: "sid", localPath: "/l", remotePath: "/r", transferId: "tid" });
    expect(sftpUpload).not.toHaveBeenCalled();
    expect(sftpUploadDirTar).not.toHaveBeenCalled();
    expect(sftpDownloadDirTar).not.toHaveBeenCalled();
  });
});

describe("executeSequenceForTargets", () => {
  it("isolates target failures and reports per-target outcome", async () => {
    const good = { runScript: vi.fn(async () => {}), runTransfer: vi.fn(async () => {}), close: vi.fn(async () => {}) };
    const bad = { runScript: vi.fn(async () => { throw new Error("perm denied"); }), runTransfer: vi.fn(async () => {}), close: vi.fn(async () => {}) };
    const leaf = [{ kind: "script", content: "x" }] as const;
    const res = await executeSequenceForTargets(
      [
        { label: "web-1", steps: leaf as never, exec: good },
        { label: "web-2", steps: leaf as never, exec: bad },
      ],
    );
    expect(res.targets.find((t) => t.label === "web-1")?.ok).toBe(true);
    expect(res.targets.find((t) => t.label === "web-2")?.ok).toBe(false);
    expect(res.targets.find((t) => t.label === "web-2")?.error).toMatch(/perm denied/);
    expect(good.runScript).toHaveBeenCalledWith("x");
  });
});

describe("buildTargetContext — per-target dynamic resolution", () => {
  const conn = (over: Partial<Connection>): Connection => ({
    id: "c", host: "h", port: 22, username: "u", auth_type: "password",
    tags: [], created_at: "", last_used_at: null, vault_id: "personal", ...over,
  } as Connection);

  it("resolves connection host/username/name per target", () => {
    const t2 = buildTargetContext({ kind: "connection", connection: conn({ host: "h2", username: "u2", name: "n2" }) });
    const t3 = buildTargetContext({ kind: "connection", connection: conn({ host: "h3", username: "u3" }) });
    expect(t2.connectionHost).toBe("h2");
    expect(t2.connectionUsername).toBe("u2");
    expect(t2.connectionName).toBe("n2");
    // A second fan-out target resolves {{connection.host}} to ITS own host, not h2.
    expect(t3.connectionHost).toBe("h3");
    expect(t3.connectionName).toBe("h3"); // falls back to host when name unset
  });
});

describe("runSnippetSequence — sftp channel lifecycle", () => {
  function transferSnippet(): Snippet {
    return {
      id: "s1",
      name: "xfer",
      steps: [{ kind: "transfer", direction: "upload", local_path: "/l", remote_path: "/r", is_dir: false }],
      tags: [],
      favorite: false,
      only_for_connection_tags: [],
      only_for_distros: [],
      created_at: "", updated_at: "", vault_id: "personal", clocks: {},
    };
  }

  it("closes a session-opened sftp channel after a transfer run", async () => {
    const res = await runSnippetSequence(
      transferSnippet(),
      [{ kind: "session", sessionId: "sess-1", sessionType: "ssh" }],
      () => {},
    );
    expect(res).not.toBe("prompting");
    expect(sftpUpload).toHaveBeenCalledWith({ sftpId: "fake-sftp-id", localPath: "/l", remotePath: "/r", transferId: "tid" });
    expect(sftpClose).toHaveBeenCalledWith("fake-sftp-id");
  });
});

describe("resolveTerminalTargets", () => {
  it("rewrites a connected saved host into a live session target", async () => {
    const conn = mkConn({ id: "c1", connection_type: "ssh" });
    const { resolutions, openedSessionIds } = await resolveTerminalTargets(
      [{ kind: "connection", connection: conn }],
      {
        connectMany: async () => ["s1"],
        getSessions: () => [sess({ id: "s1", status: "connected", type: "ssh" })],
        subscribe: immediateSubscribe,
      },
    );
    expect(openedSessionIds).toEqual(["s1"]);
    expect(resolutions[0]).toEqual({ kind: "target", target: { kind: "session", sessionId: "s1", sessionType: "ssh" } });
  });

  it("marks a saved host that never connects as failed", async () => {
    const conn = mkConn({ id: "c1", connection_type: "ssh" });
    const { resolutions, openedSessionIds } = await resolveTerminalTargets(
      [{ kind: "connection", connection: conn }],
      {
        connectMany: async () => ["s1"],
        getSessions: () => [sess({ id: "s1", status: "error" })],
        subscribe: immediateSubscribe,
      },
    );
    expect(openedSessionIds).toEqual([]);
    expect(resolutions[0]).toEqual({ kind: "failed", connection: conn });
  });

  it("passes existing session targets through and only connects connections", async () => {
    const conn = mkConn({ id: "c1", connection_type: "ssh" });
    const connectMany = vi.fn(async () => ["s1"]);
    const { resolutions } = await resolveTerminalTargets(
      [
        { kind: "session", sessionId: "pre", sessionType: "ssh" },
        { kind: "connection", connection: conn },
      ],
      {
        connectMany,
        getSessions: () => [sess({ id: "s1", status: "connected", type: "ssh" })],
        subscribe: immediateSubscribe,
      },
    );
    expect(connectMany).toHaveBeenCalledWith(["c1"]);
    expect(resolutions[0]).toEqual({ kind: "target", target: { kind: "session", sessionId: "pre", sessionType: "ssh" } });
    expect(resolutions[1]).toEqual({ kind: "target", target: { kind: "session", sessionId: "s1", sessionType: "ssh" } });
  });

  it("marks an FTP host as failed without attempting a terminal connect", async () => {
    const ftp = mkConn({ id: "f1", connection_type: "ftp" });
    const connectMany = vi.fn(async () => [] as string[]);
    const { resolutions, openedSessionIds } = await resolveTerminalTargets(
      [{ kind: "connection", connection: ftp }],
      { connectMany, getSessions: () => [], subscribe: immediateSubscribe },
    );
    expect(connectMany).not.toHaveBeenCalled();
    expect(openedSessionIds).toEqual([]);
    expect(resolutions[0]).toEqual({ kind: "failed", connection: ftp });
  });
});

describe("runSnippetSequence — saved-host script target", () => {
  function scriptSnippet(): Snippet {
    return {
      id: "s1", name: "run", steps: [{ kind: "script", content: "echo hi" }],
      tags: [], favorite: false, only_for_connection_tags: [], only_for_distros: [],
      created_at: "", updated_at: "", vault_id: "personal", clocks: {},
    };
  }

  it("reports the target as failed when no terminal can be opened (no error/hang)", async () => {
    const conn = mkConn({ id: "nope", name: "web-1", connection_type: "ssh" });
    const res = await runSnippetSequence(scriptSnippet(), [{ kind: "connection", connection: conn }], () => {});
    expect(res).not.toBe("prompting");
    const r = res as SequenceRunResult;
    expect(r.targets).toHaveLength(1);
    expect(r.targets[0].ok).toBe(false);
    expect(r.targets[0].label).toBe("web-1");
  });
});

describe("runSnippetSequence — clipboard", () => {
  function clipboardSnippet(): Snippet {
    return {
      id: "s1", name: "xfer",
      steps: [{ kind: "transfer", direction: "upload", local_path: "/tmp/{{clipboard}}", remote_path: "/r", is_dir: false }],
      tags: [], favorite: false, only_for_connection_tags: [], only_for_distros: [],
      created_at: "", updated_at: "", vault_id: "personal", clocks: {},
    };
  }
  function plainTransferSnippet(): Snippet {
    return { ...clipboardSnippet(), steps: [{ kind: "transfer", direction: "upload", local_path: "/l", remote_path: "/r", is_dir: false }] };
  }

  it("reads {{clipboard}} once and resolves it into a step path", async () => {
    const res = await runSnippetSequence(
      clipboardSnippet(),
      [{ kind: "session", sessionId: "s1", sessionType: "ssh" }],
      () => {},
    );
    expect(res).not.toBe("prompting");
    expect(readClipboard).toHaveBeenCalledTimes(1);
    expect(sftpUpload).toHaveBeenCalledWith({ sftpId: "fake-sftp-id", localPath: "/tmp/PASTED", remotePath: "/r", transferId: "tid" });
  });

  it("does not read the clipboard when no step uses it", async () => {
    await runSnippetSequence(
      plainTransferSnippet(),
      [{ kind: "session", sessionId: "s1", sessionType: "ssh" }],
      () => {},
    );
    expect(readClipboard).not.toHaveBeenCalled();
  });
});

describe("buildSummaryMessage", () => {
  it("reports all-success", () => {
    const m = buildSummaryMessage({ targets: [{ label: "web-1", ok: true }], flattenErrors: [] });
    expect(m.severity).toBe("success");
  });
  it("reports partial failure with the failing target and reason", () => {
    const m = buildSummaryMessage({ targets: [{ label: "web-1", ok: true }, { label: "web-2", ok: false, error: "denied" }], flattenErrors: [] });
    expect(m.severity).toBe("warning");
    expect(m.message).toContain("web-2");
    expect(m.message).toContain("denied");
  });
  it("surfaces flatten errors", () => {
    const m = buildSummaryMessage({ targets: [{ label: "web-1", ok: true }], flattenErrors: ["Snippet cycle detected in \"A\""] });
    expect(m.message).toMatch(/cycle/i);
  });
});
