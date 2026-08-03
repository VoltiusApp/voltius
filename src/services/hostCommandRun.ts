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
  const cmd = resolveHostCommand(conn, slot);
  if (!cmd) return;

  const hostLabel = conn.name ?? conn.host;

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

  const targets: RunTarget[] = [{ kind: "session", sessionId, sessionType }];
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
            if (!conn.ask_vars_each_time) rememberVars(conn.id, snippet.id, values, p.userVars);
            return r;
          } finally {
            settle();
          }
        },
      });
    });

    if (result === "prompting") {
      await settled;
      return;
    }
    deps.report(result);
  } catch (e) {
    deps.notifyError(i18n.t("hosts.hostCommand.failed", {
      host: hostLabel, error: e instanceof Error ? e.message : String(e),
    }));
  }
}
