import type { TeamObjectType } from "@/services/teamObjects";
import { appToast } from "@/services/appToast";

export interface PreviewTarget {
  type: TeamObjectType;
  objectId: string;
}

export const targetOf = (type: TeamObjectType) => (objectId: string | undefined): PreviewTarget | undefined =>
  objectId === undefined ? undefined : { type, objectId };
export const connectionTarget = targetOf("connection");
export const folderTarget = targetOf("folder");
export const snippetTarget = targetOf("snippet");
export const keyTarget = targetOf("key");
export const identityTarget = targetOf("identity");
export const ruleTarget = targetOf("port_forwarding_rule");

interface PreviewBinding {
  active: () => boolean;
  /** Opens Why for an object the current result explains; false when it has none. */
  explain: (type: TeamObjectType, objectId: string) => boolean;
}

// Bound by previewStore at load: it imports the stores guarded here, so a static import would cycle.
let binding: PreviewBinding | null = null;
let authorityDepth = 0;

export class PreviewReadOnlyError extends Error {
  constructor() {
    super("Read-only preview");
    this.name = "PreviewReadOnlyError";
  }
}

export function bindPreviewGuard(next: PreviewBinding): void {
  binding = next;
}

const previewing = (): boolean => binding?.active() ?? false;

function toastReadOnly(): void {
  void import("@/i18n")
    .then(({ default: i18n }) => appToast("info", i18n.t("members.viewAs.readOnly")))
    .catch(console.error);
}

export function refuseWhilePreviewing(target?: PreviewTarget): boolean {
  if (!binding || !previewing()) return false;
  if (!target || !binding.explain(target.type, target.objectId)) toastReadOnly();
  return true;
}

export const whenWritableOn =
  <A extends unknown[], R>(target: PreviewTarget | undefined, fn: (...args: A) => R) =>
  (...args: A): R | undefined =>
    refuseWhilePreviewing(target) ? undefined : fn(...args);

export const whenWritable = <A extends unknown[], R>(fn: (...args: A) => R) => whenWritableOn(undefined, fn);

// Unlike assertNotPreviewing: can open Why for a target, and ignores withControlAuthority.
export function refuseOrThrow(target?: PreviewTarget): void {
  if (refuseWhilePreviewing(target)) throw new PreviewReadOnlyError();
}

export function assertNotPreviewing(): void {
  if (authorityDepth > 0 || !previewing()) return;
  toastReadOnly();
  throw new PreviewReadOnlyError();
}

export async function withControlAuthority<T>(fn: () => Promise<T>): Promise<T> {
  authorityDepth++;
  try {
    return await fn();
  } finally {
    authorityDepth--;
  }
}
