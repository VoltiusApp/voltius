import { describe, it, expect, vi } from "vitest";
import { runHostCommand, type HostCommandDeps } from "./hostCommandRun";
import type { Connection, Snippet } from "@/types";
import type { SequencePrompt, SequenceRunResult } from "./snippetSequence";

const OK: SequenceRunResult = { targets: [{ label: "h", ok: true }], flattenErrors: [] };

function mkConn(over: Partial<Connection>): Connection {
  return {
    id: "c1", host: "h", port: 22, username: "u", auth_type: "password",
    tags: [], created_at: "", last_used_at: null, vault_id: "personal", clocks: {},
    updated_at: "", ...over,
  } as Connection;
}

const snippet = { id: "s1", name: "boot", steps: [{ kind: "script", content: "uptime" }] } as Snippet;

function mkDeps(over: Partial<HostCommandDeps> = {}): HostCommandDeps {
  return {
    findSnippet: (id) => (id === "s1" ? snippet : undefined),
    runSequence: vi.fn(async () => OK),
    report: vi.fn(),
    enqueue: vi.fn(),
    inject: vi.fn(async () => {}),
    notifyError: vi.fn(),
    ...over,
  };
}

describe("runHostCommand", () => {
  it("does nothing when the slot is unset", async () => {
    const deps = mkDeps();
    await runHostCommand(mkConn({}), "pre", "sess1", "ssh", deps);
    expect(deps.runSequence).not.toHaveBeenCalled();
    expect(deps.inject).not.toHaveBeenCalled();
  });

  it("ignores inline commands on ssh — Rust already ran them", async () => {
    const deps = mkDeps();
    await runHostCommand(mkConn({ pre_command: "uptime" }), "pre", "sess1", "ssh", deps);
    expect(deps.inject).not.toHaveBeenCalled();
  });

  it("injects inline commands on serial, which has no Rust path", async () => {
    const deps = mkDeps();
    await runHostCommand(mkConn({ pre_command: "uptime" }), "pre", "sess1", "serial", deps);
    expect(deps.inject).toHaveBeenCalledWith("sess1", "serial", "uptime", true);
  });

  it("runs the snippet against the live session and reports the result", async () => {
    const deps = mkDeps();
    await runHostCommand(mkConn({ pre_snippet_id: "s1" }), "pre", "sess1", "ssh", deps);

    expect(deps.runSequence).toHaveBeenCalledTimes(1);
    const [passedSnippet, targets] = (deps.runSequence as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(passedSnippet.id).toBe("s1");
    expect(targets).toEqual([{ kind: "session", sessionId: "sess1", sessionType: "ssh" }]);
    expect(deps.report).toHaveBeenCalledWith(OK);
  });

  it("reports an error and resolves when the snippet id is dangling", async () => {
    const deps = mkDeps();
    await runHostCommand(mkConn({ pre_snippet_id: "gone" }), "pre", "sess1", "ssh", deps);
    expect(deps.notifyError).toHaveBeenCalled();
    expect(deps.runSequence).not.toHaveBeenCalled();
  });

  it("resolves without throwing when the sequence rejects", async () => {
    const deps = mkDeps({ runSequence: vi.fn(async () => { throw new Error("boom"); }) });
    await expect(
      runHostCommand(mkConn({ pre_snippet_id: "s1" }), "pre", "sess1", "ssh", deps),
    ).resolves.toBeUndefined();
    expect(deps.notifyError).toHaveBeenCalled();
  });

  it("waits for a prompt to be submitted before resolving", async () => {
    let captured: SequencePrompt | undefined;
    const deps = mkDeps({
      runSequence: vi.fn(async (_s, _t, onPrompt) => {
        onPrompt({
          snippet, userVars: [], partialTemplate: "", initialValues: {},
          resume: async () => OK,
        });
        return "prompting" as const;
      }),
      enqueue: vi.fn((p: SequencePrompt) => { captured = p; }),
    });

    let settled = false;
    const promise = runHostCommand(mkConn({ pre_snippet_id: "s1" }), "pre", "sess1", "ssh", deps)
      .then(() => { settled = true; });

    await Promise.resolve();
    expect(settled).toBe(false);

    await captured!.resume({});
    await promise;
    expect(settled).toBe(true);
  });

  it("resolves when a prompt is dismissed instead of submitted", async () => {
    let captured: SequencePrompt | undefined;
    const deps = mkDeps({
      runSequence: vi.fn(async (_s, _t, onPrompt) => {
        onPrompt({
          snippet, userVars: [], partialTemplate: "", initialValues: {},
          resume: async () => OK,
        });
        return "prompting" as const;
      }),
      enqueue: vi.fn((p: SequencePrompt) => { captured = p; }),
    });

    const promise = runHostCommand(mkConn({ pre_snippet_id: "s1" }), "pre", "sess1", "ssh", deps);
    captured!.onDismissed!();
    await expect(promise).resolves.toBeUndefined();
  });

  it("labels the prompt with the host name and the slot", async () => {
    let captured: SequencePrompt | undefined;
    const deps = mkDeps({
      runSequence: vi.fn(async (_s, _t, onPrompt) => {
        onPrompt({
          snippet, userVars: [], partialTemplate: "", initialValues: {},
          resume: async () => OK,
        });
        return "prompting" as const;
      }),
      enqueue: vi.fn((p: SequencePrompt) => { captured = p; }),
    });

    const promise = runHostCommand(
      mkConn({ pre_snippet_id: "s1", name: "web-01" }), "pre", "sess1", "ssh", deps,
    );
    expect(captured!.contextLabel).toContain("web-01");
    captured!.onDismissed!();
    await promise;
  });
});
