import type { Snippet, SnippetStep } from "@/types";

export function stepsFromLegacy(content: string): SnippetStep[] {
  return [{ kind: "script", content }];
}

/** Migrate a legacy `{direction,local_path,remote_path}` transfer to the
 *  symmetric from/to shape. Already-migrated and non-transfer steps pass
 *  through unchanged (idempotent). */
export function migrateTransferStep(step: unknown): SnippetStep {
  const s = step as Record<string, unknown>;
  if (s.kind !== "transfer" || "from" in s) return step as SnippetStep;
  const isUpload = s.direction === "upload";
  return {
    kind: "transfer",
    from: isUpload ? "local" : "remote",
    to: isUpload ? "remote" : "local",
    from_path: String(isUpload ? s.local_path : s.remote_path),
    to_path: String(isUpload ? s.remote_path : s.local_path),
    is_dir: !!s.is_dir,
    mode: "copy",
    on_conflict: "overwrite",
  };
}

/** Steps carry a local `snippet_id` in the vault and an `_eid` in a bundle, so
 *  normalization stays generic over the step shape rather than assuming either. */
type StepsOf<T> = T extends { steps?: (infer S)[] } ? S : never;

export function normalizeSnippetSteps<T extends { steps?: unknown[]; content?: string }>(
  raw: T,
): T & { steps: StepsOf<T>[] } {
  if (raw.steps && raw.steps.length > 0) {
    return { ...raw, steps: raw.steps.map(migrateTransferStep) as StepsOf<T>[] };
  }
  return { ...raw, steps: stepsFromLegacy(raw.content ?? "") as StepsOf<T>[] };
}

export function snippetScriptText(snippet: Pick<Snippet, "steps">): string {
  return snippet.steps
    .filter((s): s is Extract<SnippetStep, { kind: "script" }> => s.kind === "script")
    .map((s) => s.content)
    .join("\n");
}

export function snippetSearchText(snippet: Pick<Snippet, "steps">): string {
  return snippet.steps
    .map((s) => {
      if (s.kind === "script") return s.content;
      if (s.kind === "transfer") return `${s.from_path} ${s.to_path}`;
      return "";
    })
    .join("\n");
}
