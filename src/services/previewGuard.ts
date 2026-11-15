import type { TeamObjectType } from "@/services/teamObjects";
import { appToast } from "@/services/appToast";

export interface PreviewTarget {
  type: TeamObjectType;
  objectId: string;
}

const targetOf = (type: TeamObjectType) => (objectId: string): PreviewTarget => ({ type, objectId });
export const connectionTarget = targetOf("connection");
export const folderTarget = targetOf("folder");
export const snippetTarget = targetOf("snippet");

interface PreviewBinding {
  active: () => boolean;
  showWhy: (type: TeamObjectType, objectId: string) => void;
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

export function refuseWhilePreviewing(target?: PreviewTarget): boolean {
  if (!binding || !previewing()) return false;
  if (target) binding.showWhy(target.type, target.objectId);
  else void import("@/i18n").then(({ default: i18n }) => appToast("info", i18n.t("members.viewAs.readOnly")));
  return true;
}

export function refuseOrThrow(target?: PreviewTarget): void {
  if (refuseWhilePreviewing(target)) throw new PreviewReadOnlyError();
}

export function assertNotPreviewing(): void {
  if (authorityDepth === 0 && previewing()) throw new PreviewReadOnlyError();
}

export async function withControlAuthority<T>(fn: () => Promise<T>): Promise<T> {
  authorityDepth++;
  try {
    return await fn();
  } finally {
    authorityDepth--;
  }
}
