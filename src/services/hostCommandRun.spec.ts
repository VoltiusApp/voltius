import { describe, it, expect, vi, afterEach } from "vitest";
import type { Connection, Snippet } from "@/types";
import type { SequencePrompt, SequenceRunResult } from "./snippetSequence";
import type { ParsedVariable } from "./snippetParser";

const rememberedVars = vi.fn((_connectionId: string, _snippetId: string) => ({}) as Record<string, string>);
const rememberVars = vi.fn(
  (_connectionId: string, _snippetId: string, _values: Record<string, string>, _vars: ParsedVariable[]) => {},
);
vi.mock("@/stores/hostCommandVarsStore", () => ({
  rememberedVars: (...a: [string, string]) => rememberedVars(...a),
  rememberVars: (...a: [string, string, Record<string, string>, ParsedVariable[]]) => rememberVars(...a),
}));

import { runHostCommand, type HostCommandDeps } from "./hostCommandRun";

const OK: SequenceRunResult = { targets: [{ label: "h", ok: true }], flattenErrors: [] };

function mkConn(over: Partial<Connection>): Connection {
  return {
    id: "c1", host: "h", port: 22, username: "u", auth_type: "password",
    tags: [], created_at: "", last_used_at: null, vault_id: "personal", clocks: {},
    updated_at: "", ...over,
  } as Connection;
}

const snippet = { id: "s1", name: "boot", steps: [{ kind: "script", content: "uptime" }] } as Snippet;
const userVars: ParsedVariable[] = [{ name: "envName", type: "text", dynamic: false }] as ParsedVariable[];

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

function promptingDeps(over: Partial<HostCommandDeps> = {}) {
  let captured: SequencePrompt | undefined;
  const deps = mkDeps({
    runSequence: vi.fn(async (_s, _t, onPrompt) => {
      onPrompt({
        snippet, userVars, partialTemplate: "", initialValues: { envName: "default" },
        resume: async () => OK,
      });
      return "prompting" as const;
    }),
    enqueue: vi.fn((p: SequencePrompt) => { captured = p; }),
    ...over,
  });
  return { deps, getCaptured: () => captured! };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  vi.useRealTimers();
  rememberedVars.mockClear().mockReturnValue({});
  rememberVars.mockClear();
});

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

  it("resolves without throwing even when notifyError itself throws", async () => {
    const deps = mkDeps({
      runSequence: vi.fn(async () => { throw new Error("boom"); }),
      notifyError: vi.fn(() => { throw new Error("notify blew up"); }),
    });
    await expect(
      runHostCommand(mkConn({ pre_snippet_id: "s1" }), "pre", "sess1", "ssh", deps),
    ).resolves.toBeUndefined();
  });

  it("waits for a prompt to be submitted before resolving", async () => {
    const { deps, getCaptured } = promptingDeps();

    let settled = false;
    const promise = runHostCommand(mkConn({ pre_snippet_id: "s1" }), "pre", "sess1", "ssh", deps)
      .then(() => { settled = true; });

    await tick();
    await tick();
    await tick();
    expect(settled).toBe(false);
    expect(deps.report).not.toHaveBeenCalled();

    await getCaptured().resume({});
    await promise;
    expect(settled).toBe(true);
  });

  it("resolves when a prompt is dismissed instead of submitted", async () => {
    const { deps, getCaptured } = promptingDeps();

    const promise = runHostCommand(mkConn({ pre_snippet_id: "s1" }), "pre", "sess1", "ssh", deps);
    getCaptured().onDismissed!();
    await expect(promise).resolves.toBeUndefined();
  });

  it("labels the prompt with the host name and the slot", async () => {
    const { deps, getCaptured } = promptingDeps();

    const promise = runHostCommand(
      mkConn({ pre_snippet_id: "s1", name: "web-01" }), "pre", "sess1", "ssh", deps,
    );
    expect(getCaptured().contextLabel).toContain("web-01");
    getCaptured().onDismissed!();
    await promise;
  });

  describe("remembered variables", () => {
    it("seeds the enqueued prompt's initialValues from remembered values, overriding snippet defaults", async () => {
      rememberedVars.mockReturnValue({ envName: "remembered-prod" });
      const { deps, getCaptured } = promptingDeps();

      const promise = runHostCommand(mkConn({ pre_snippet_id: "s1" }), "pre", "sess1", "ssh", deps);
      expect(rememberedVars).toHaveBeenCalledWith("c1", "s1");
      expect(getCaptured().initialValues).toEqual({ envName: "remembered-prod" });
      getCaptured().onDismissed!();
      await promise;
    });

    it("neither reads nor writes remembered values when ask_vars_each_time is set", async () => {
      rememberedVars.mockReturnValue({ envName: "remembered-prod" });
      const { deps, getCaptured } = promptingDeps();

      const promise = runHostCommand(
        mkConn({ pre_snippet_id: "s1", ask_vars_each_time: true }), "pre", "sess1", "ssh", deps,
      );
      expect(rememberedVars).not.toHaveBeenCalled();
      expect(getCaptured().initialValues).toEqual({ envName: "default" });

      await getCaptured().resume({ envName: "typed" });
      await promise;
      expect(rememberVars).not.toHaveBeenCalled();
    });

    it("remembers values after a successful resume", async () => {
      const { deps, getCaptured } = promptingDeps();

      const promise = runHostCommand(mkConn({ pre_snippet_id: "s1" }), "pre", "sess1", "ssh", deps);
      await getCaptured().resume({ envName: "prod" });
      await promise;

      expect(rememberVars).toHaveBeenCalledWith("c1", "s1", { envName: "prod" }, userVars);
    });

    it("does not remember values when the prompt is dismissed", async () => {
      const { deps, getCaptured } = promptingDeps();

      const promise = runHostCommand(mkConn({ pre_snippet_id: "s1" }), "pre", "sess1", "ssh", deps);
      getCaptured().onDismissed!();
      await promise;

      expect(rememberVars).not.toHaveBeenCalled();
    });
  });

  describe("post-command prompt timeout", () => {
    it("resolves and notifies after 60s with no response, on the post slot", async () => {
      vi.useFakeTimers();
      const { deps, getCaptured } = promptingDeps();

      let settled = false;
      const promise = runHostCommand(mkConn({ post_snippet_id: "s1" }), "post", "sess1", "ssh", deps)
        .then(() => { settled = true; });

      await vi.advanceTimersByTimeAsync(0);
      void getCaptured();
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(60_000);
      await promise;
      expect(settled).toBe(true);
      expect(deps.notifyError).toHaveBeenCalled();
    });

    it("does not bound a pre-command prompt, even past 60s", async () => {
      vi.useFakeTimers();
      const { deps, getCaptured } = promptingDeps();

      let settled = false;
      const promise = runHostCommand(mkConn({ pre_snippet_id: "s1" }), "pre", "sess1", "ssh", deps)
        .then(() => { settled = true; });

      await vi.advanceTimersByTimeAsync(0);
      void getCaptured();
      await vi.advanceTimersByTimeAsync(60_000);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(settled).toBe(false);
      expect(deps.notifyError).not.toHaveBeenCalled();

      getCaptured().onDismissed!();
      await promise;
    });
  });
});
