import i18n from "@/i18n";
import { resolveHostCommand, type HostCommandSlot } from "./hostCommand";
import { runSnippetSequence, reportSequenceResult } from "./snippetSequence";
import { snippetInject } from "./snippets";
import { useSnippetStore } from "@/stores/snippetStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { rememberedVars, rememberVars } from "@/stores/hostCommandVarsStore";
import type { RunTarget } from "./sftpTarget";
import type { SequencePrompt, SequenceRunResult } from "./snippetSequence";
import type { Connection, Snippet } from "@/types";

export interface HostCommandDeps {
  findSnippet: (id: string) => Snippet | undefined;
  runSequence: typeof runSnippetSequence;
  report: (r: SequenceRunResult) => void;
  enqueue: (p: SequencePrompt) => void;
  inject: (sessionId: string, sessionType: string, text: string, execute: boolean) => Promise<void>;
  notifyError: (message: string) => void;
}

export function defaultHostCommandDeps(): HostCommandDeps {
  return {
    findSnippet: (id) => {
      const s = useSnippetStore.getState();
      return [...s.snippets, ...Object.values(s.teamSnippets).flat()].find((sn) => sn.id === id);
    },
    runSequence: runSnippetSequence,
    report: reportSequenceResult,
    enqueue: (p) => useSnippetStore.getState().enqueuePendingSequence(p),
    inject: snippetInject,
    notifyError: (message) =>
      useNotificationStore.getState().addToast({
        pluginId: "snippets", pluginName: "Snippets", type: "toast",
        message, severity: "error", duration: 8000,
      }),
  };
}

/** Only post-command prompts are bounded: an unanswered pre-command prompt is
 *  fine (nothing to tear down yet), but an unanswered post-command prompt would
 *  strand the session's teardown forever. */
const POST_PROMPT_TIMEOUT_MS = 60_000;

async function waitForSettled(
  settled: Promise<void>,
  slot: HostCommandSlot,
  hostLabel: string,
  deps: HostCommandDeps,
): Promise<void> {
  if (slot !== "post") {
    await settled;
    return;
  }

  let timer: ReturnType<typeof setTimeout>;
  const timedOut = new Promise<true>((resolve) => {
    timer = setTimeout(() => resolve(true), POST_PROMPT_TIMEOUT_MS);
  });
  const raceResult = await Promise.race([settled.then(() => false as const), timedOut]);
  clearTimeout(timer!);

  if (raceResult) {
    deps.notifyError(i18n.t("hosts.hostCommand.postPromptTimedOut", { host: hostLabel }));
  }
}

/**
 * Run a host's pre/post command against an established session. Never rejects:
 * a failing host command must not fail the connection or block teardown.
 */
export async function runHostCommand(
  conn: Connection,
  slot: HostCommandSlot,
  sessionId: string,
  sessionType: string,
  deps: HostCommandDeps = defaultHostCommandDeps(),
): Promise<void> {
  try {
    const cmd = resolveHostCommand(conn, slot);
    if (!cmd) return;

    const hostLabel = conn.name || conn.host;

    if (cmd.kind === "inline") {
      // SSH inline commands are written by Rust; serial has no Rust path.
      if (sessionType !== "serial") return;
      try {
        await deps.inject(sessionId, sessionType, cmd.text, true);
      } catch (e) {
        deps.notifyError(i18n.t("hosts.hostCommand.failed", {
          host: hostLabel, error: e instanceof Error ? e.message : String(e),
        }));
      }
      return;
    }

    const snippet = deps.findSnippet(cmd.id);
    if (!snippet) {
      deps.notifyError(i18n.t("hosts.hostCommand.missingSnippet", { host: hostLabel }));
      return;
    }

    // Capture the host context up front: a post-command outlives its session row,
    // so resolving {{connection.*}} from the store later would yield the local shell.
    const targets: RunTarget[] = [{
      kind: "session",
      sessionId,
      sessionType,
      context: {
        connectionHost: conn.host,
        connectionUsername: conn.username,
        connectionName: conn.name ?? conn.host,
      },
      label: hostLabel,
    }];
    const contextLabel = i18n.t(
      slot === "pre" ? "hosts.hostCommand.labelPre" : "hosts.hostCommand.labelPost",
      { host: hostLabel },
    );

    let settle: () => void = () => {};
    const settled = new Promise<void>((resolve) => { settle = resolve; });

    try {
      const result = await deps.runSequence(snippet, targets, (p) => {
        const seeded = conn.ask_vars_each_time
          ? p.initialValues
          : { ...p.initialValues, ...rememberedVars(conn.id, snippet.id) };

        deps.enqueue({
          ...p,
          initialValues: seeded,
          contextLabel,
          onDismissed: settle,
          resume: async (values) => {
            try {
              const r = await p.resume(values);
              // runWith never throws on a per-target failure; only remember values
              // that actually worked somewhere.
              if (!conn.ask_vars_each_time && r.targets.some((t) => t.ok)) {
                rememberVars(conn.id, snippet.id, values, p.userVars);
              }
              return r;
            } finally {
              settle();
            }
          },
        });
      });

      if (result === "prompting") {
        await waitForSettled(settled, slot, hostLabel, deps);
        return;
      }
      deps.report(result);
    } catch (e) {
      deps.notifyError(i18n.t("hosts.hostCommand.failed", {
        host: hostLabel, error: e instanceof Error ? e.message : String(e),
      }));
    }
  } catch {
    // runHostCommand must never reject, even if a dep (e.g. notifyError) throws.
  }
}
