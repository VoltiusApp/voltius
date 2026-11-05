export class ServerBlockedError extends Error {
  readonly #pendingSecret?: string;

  constructor(pendingSecret?: string) {
    super("Account server is not allowed by policy");
    this.#pendingSecret = pendingSecret;
  }

  get pendingSecret(): string | undefined {
    return this.#pendingSecret;
  }
}

export class AccountNotSavedError extends Error {
  constructor() {
    super("The current account could not be saved");
  }
}

export class AccountAlreadyActiveError extends Error {
  constructor() {
    super("This account is already signed in");
  }
}

export function accountErrorText(e: unknown, t: (key: string) => string): string {
  if (e instanceof ServerBlockedError) return t("common.policy.serverBlocked");
  if (e instanceof AccountNotSavedError) return t("common.policy.accountNotSaved");
  if (e instanceof AccountAlreadyActiveError) return t("common.error.accountAlreadyActive");
  return e instanceof Error ? e.message : String(e);
}
