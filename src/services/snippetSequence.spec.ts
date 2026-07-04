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

import { runTransferStep, executeSequenceForTargets, runSnippetSequence, buildSummaryMessage, buildTargetContext } from "./snippetSequence";
import type { Connection } from "@/types";
import type { Snippet } from "@/types";

beforeEach(() => {
  sftpUpload.mockClear(); sftpDownload.mockClear(); sftpUploadDirTar.mockClear();
  sftpDownloadDirTar.mockClear(); sftpClose.mockClear(); resolveSftpIdForTarget.mockClear();
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
