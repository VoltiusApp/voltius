import type { SnippetStep } from "@/types";

/** A `SnippetStep` as it travels in a bundle: nested calls reference the target
 *  snippet's `_eid` rather than a local id, which means nothing on the importing
 *  machine. */
export type SnippetStepExport =
  | Exclude<SnippetStep, { kind: "snippet" }>
  | { kind: "snippet"; _eid: string };

export class SnippetRefError extends Error {
  constructor(message: string, readonly snippetName: string, readonly target: string) {
    super(message);
  }
}

/** The `_eid`s a snippet's nested calls point at. A legacy bundle carries a raw
 *  `snippet_id` instead, which yields `undefined` — unresolvable by design. */
export function refEids(steps: SnippetStepExport[]): (string | undefined)[] {
  return steps.filter(s => s.kind === "snippet").map(s => (s as { _eid?: string })._eid);
}

export function stepsToExport(
  steps: SnippetStep[],
  idToEid: Map<string, string>,
  snippetName: string,
): SnippetStepExport[] {
  return steps.map((step) => {
    if (step.kind !== "snippet") return step;
    const eid = idToEid.get(step.snippet_id);
    if (!eid) {
      throw new SnippetRefError(
        `Snippet "${snippetName}" calls a snippet that is not part of this export (${step.snippet_id})`,
        snippetName, step.snippet_id,
      );
    }
    return { kind: "snippet", _eid: eid };
  });
}

export function stepsFromExport(
  steps: SnippetStepExport[],
  eidToId: Map<string, string>,
  snippetName: string,
): SnippetStep[] {
  return steps.map((step) => {
    if (step.kind !== "snippet") return step;
    // Bundles written before the `_eid` remap carry a raw `snippet_id` that only
    // meant something on the exporting machine.
    const eid = (step as { _eid?: string })._eid;
    const id = eid ? eidToId.get(eid) : undefined;
    if (!id) {
      throw new SnippetRefError(
        `Snippet "${snippetName}" calls a snippet that is missing from this import (${eid ?? "legacy reference"})`,
        snippetName, eid ?? "legacy reference",
      );
    }
    return { kind: "snippet", snippet_id: id };
  });
}
