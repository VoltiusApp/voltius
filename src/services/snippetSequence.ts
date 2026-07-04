import { sftpUpload, sftpDownload, sftpUploadDirTar, sftpDownloadDirTar, sftpClose } from "@/services/sftp";
import { genId } from "@/components/filetransfer/SFTPTypes";
import { flattenSnippetSteps, type LeafStep } from "./snippetFlatten";
import { collectSequenceVars, resolveLeafSteps } from "./snippetSequenceCore";
import { buildDynamicContext } from "./snippetRunCore";
import { resolveSftpIdForTarget, type RunTarget } from "./sftpTarget";
import { snippetInject } from "./snippets";
import { useSnippetStore } from "@/stores/snippetStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useNotificationStore } from "@/stores/notificationStore";
import i18n from "@/i18n";
import type { Snippet } from "@/types";
import type { ParsedVariable, DynamicContext } from "./snippetParser";

type TransferStep = Extract<LeafStep, { kind: "transfer" }>;

export async function runTransferStep(sftpId: string, step: TransferStep): Promise<void> {
  const transferId = genId();
  const { local_path: localPath, remote_path: remotePath } = step;
  if (step.direction === "upload") {
    if (step.is_dir) await sftpUploadDirTar({ sftpId, localPath, remotePath, transferId });
    else await sftpUpload({ sftpId, localPath, remotePath, transferId });
  } else {
    if (step.is_dir) await sftpDownloadDirTar({ sftpId, localPath, remotePath, transferId });
    else await sftpDownload({ sftpId, localPath, remotePath, transferId });
  }
}

// ─── Sequence aggregation core ──────────────────────────────────────────────

export interface TargetRunResult { label: string; ok: boolean; error?: string }
export interface SequenceRunResult { targets: TargetRunResult[]; flattenErrors: string[] }

export interface TargetExec {
  runScript(content: string): Promise<void>;
  runTransfer(step: TransferStep): Promise<void>;
  close(): Promise<void>;
}

export interface PreparedTarget { label: string; steps: LeafStep[]; exec: TargetExec }

async function runOneTarget(steps: LeafStep[], exec: TargetExec): Promise<void> {
  try {
    for (const step of steps) {
      if (step.kind === "script") await exec.runScript(step.content);
      else await exec.runTransfer(step);
    }
  } finally {
    await exec.close().catch(() => {});
  }
}

export async function executeSequenceForTargets(
  targets: PreparedTarget[],
  flattenErrors: string[] = [],
): Promise<SequenceRunResult> {
  const results = await Promise.all(
    targets.map(async (t): Promise<TargetRunResult> => {
      try {
        await runOneTarget(t.steps, t.exec);
        return { label: t.label, ok: true };
      } catch (e) {
        return { label: t.label, ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
  return { targets: results, flattenErrors };
}

// ─── Orchestrator ───────────────────────────────────────────────────────────

export interface SequencePrompt {
  snippet: Snippet;
  userVars: ParsedVariable[];
  partialTemplate: string;
  initialValues: Record<string, string>;
  resume: (values: Record<string, string>) => Promise<SequenceRunResult>;
}

function targetLabel(target: RunTarget): string {
  if (target.kind === "connection") return target.connection.name ?? target.connection.host;
  const s = useSessionStore.getState().sessions.find((x) => x.id === target.sessionId);
  return s?.connectionName ?? target.sessionId;
}

export function needsTerminal(leaf: LeafStep[]): boolean {
  return leaf.some((s) => s.kind === "script");
}

/** Build the dynamic-variable context for a single target. Resolved per target
 *  so `{{connection.*}}` vars differ across a fan-out (host, username, name). */
export function buildTargetContext(target: RunTarget): DynamicContext {
  if (target.kind === "connection") {
    const c = target.connection;
    return { connectionHost: c.host, connectionUsername: c.username, connectionName: c.name ?? c.host };
  }
  const sess = useSessionStore.getState().sessions.find((s) => s.id === target.sessionId);
  const conns = useConnectionStore.getState().connections;
  return buildDynamicContext(sess, conns);
}

async function prepareTarget(target: RunTarget, steps: LeafStep[]): Promise<PreparedTarget> {
  const hasTransfer = steps.some((s) => s.kind === "transfer");
  let sftpId: string | null = null;
  if (hasTransfer) sftpId = await resolveSftpIdForTarget(target);

  const sessionId = target.kind === "session" ? target.sessionId : undefined;
  const sessionType = target.kind === "session" ? target.sessionType : "ssh";

  const exec: TargetExec = {
    async runScript(content) {
      if (!sessionId) throw new Error("Script step requires an open terminal session for this target");
      await snippetInject(sessionId, sessionType, content, true);
    },
    async runTransfer(step) {
      if (!sftpId) throw new Error("No SFTP connection for transfer step");
      await runTransferStep(sftpId, step);
    },
    async close() {
      // We always own sftpId (sftpOpen/sftpConnect create a fresh resource),
      // so close it whenever opened. For a live session this only tears down the
      // sftp channel, not the underlying terminal session.
      if (sftpId) await sftpClose(sftpId);
    },
  };
  return { label: targetLabel(target), steps, exec };
}

/**
 * Run a snippet sequence against targets. If the flattened sequence has
 * unfilled user variables, invokes onPrompt (which must eventually call
 * prompt.resume(values)) and returns "prompting". Otherwise runs immediately.
 */
export async function runSnippetSequence(
  snippet: Snippet,
  targets: RunTarget[],
  onPrompt: (p: SequencePrompt) => void,
): Promise<SequenceRunResult | "prompting"> {
  const snippetState = useSnippetStore.getState();
  const all = [...snippetState.snippets, ...Object.values(snippetState.teamSnippets).flat()];
  const byId = new Map(all.map((s) => [s.id, s]));
  const flat = flattenSnippetSteps(snippet, byId);

  // User-variable pass is one-shot (which vars prompt, modal preview): dynamic
  // vars never prompt and user vars are target-independent. Context here is only
  // used for the modal's partial-template preview, so the first target is fine.
  const firstTarget = targets[0];
  const previewCtx = firstTarget
    ? buildTargetContext(firstTarget)
    : { connectionHost: "", connectionUsername: "", connectionName: "" };
  const vars = collectSequenceVars(flat.steps, previewCtx);

  const runWith = async (userValues: Record<string, string>): Promise<SequenceRunResult> => {
    const prepared = await Promise.all(
      targets.map(async (t): Promise<PreparedTarget> => {
        // Resolve dynamic vars PER TARGET so {{connection.*}} differs per host.
        const targetDyn = collectSequenceVars(flat.steps, buildTargetContext(t)).dynValues;
        const stepsForTarget = resolveLeafSteps(flat.steps, { ...targetDyn, ...userValues });
        try {
          return await prepareTarget(t, stepsForTarget);
        } catch (e) {
          return {
            label: targetLabel(t),
            steps: stepsForTarget,
            exec: {
              runScript: async () => { throw e; },
              runTransfer: async () => { throw e; },
              close: async () => {},
            },
          };
        }
      }),
    );
    return executeSequenceForTargets(prepared, flat.errors);
  };

  if (vars.missing.length > 0) {
    onPrompt({
      snippet,
      userVars: vars.userVars,
      partialTemplate: vars.partialTemplate,
      initialValues: vars.initialValues,
      resume: runWith,
    });
    return "prompting";
  }
  return runWith(vars.initialValues);
}

// ─── Run-summary reporting ──────────────────────────────────────────────────

export function buildSummaryMessage(result: SequenceRunResult): { message: string; severity: "success" | "warning" | "error" } {
  const failed = result.targets.filter((t) => !t.ok);
  const parts: string[] = [];
  for (const f of failed) parts.push(`${f.label}: ${f.error ?? i18n.t("snippets.sequence.summary.failed")}`);
  for (const e of result.flattenErrors) parts.push(e);
  const okCount = result.targets.length - failed.length;

  if (parts.length === 0) {
    return { message: i18n.t("snippets.sequence.summary.success", { count: okCount }), severity: "success" };
  }
  const severity = okCount > 0 ? "warning" : "error";
  return {
    message: i18n.t("snippets.sequence.summary.partial", { count: okCount, details: parts.join("; ") }),
    severity,
  };
}

export function reportSequenceResult(result: SequenceRunResult): void {
  const { message, severity } = buildSummaryMessage(result);
  useNotificationStore.getState().addToast({
    pluginId: "snippets",
    pluginName: "Snippets",
    type: "toast",
    message,
    severity,
    duration: severity === "success" ? 4000 : 8000,
  });
}
