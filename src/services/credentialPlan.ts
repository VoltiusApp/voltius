import type { Identity } from "@/types";

export type PickTarget = Pick<Identity, "id" | "name" | "username" | "key_id">;
export type PickIssueReason = "missing" | "forbidden";

export interface CredentialScope {
  teamId: string | null;
  hostPickId: string | null;
  vaultDefaultId: string | null;
  hostHasSharedCredential: boolean;
  lookup: (identityId: string) => PickTarget | PickIssueReason;
}

export type CredentialPlan =
  | { kind: "host" }
  | { kind: "pick" | "default"; identity: PickTarget }
  | { kind: "unavailable"; via: "pick" | "default"; identityId: string; reason: PickIssueReason; hasFallback: boolean };

export interface IdentityPickIssue {
  connectionId: string;
  connectionName: string;
  via: "pick" | "default";
  reason: PickIssueReason;
  identityName?: string;
  hasFallback: boolean;
  fallbackName?: string;
}

function fromChoice(via: "pick" | "default", identityId: string, scope: CredentialScope, hasFallback: boolean): CredentialPlan {
  const hit = scope.lookup(identityId);
  return typeof hit === "string"
    ? { kind: "unavailable", via, identityId, reason: hit, hasFallback }
    : { kind: via, identity: hit };
}

export function planCredentials(scope: CredentialScope, { skipPick = false }: { skipPick?: boolean } = {}): CredentialPlan {
  if (!scope.teamId) return { kind: "host" };
  if (scope.hostPickId && !skipPick) return fromChoice("pick", scope.hostPickId, scope, scope.hostHasSharedCredential);
  if (scope.hostHasSharedCredential) return { kind: "host" };
  if (scope.vaultDefaultId) return fromChoice("default", scope.vaultDefaultId, scope, false);
  return { kind: "host" };
}

export class IdentityPickUnavailableError extends Error {
  constructor(readonly issue: IdentityPickIssue, message: string) {
    super(message);
    this.name = "IdentityPickUnavailableError";
  }
}

export function identityPickIssueOf(err: unknown): IdentityPickIssue | undefined {
  return err instanceof IdentityPickUnavailableError ? err.issue : undefined;
}
