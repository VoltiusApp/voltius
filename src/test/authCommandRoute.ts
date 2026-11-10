import type { AuthWireError } from "@/services/authClient";

const AUTH_COMMANDS = ["auth_challenge", "auth_login", "auth_second_factor", "auth_passkey_start"] as const;
type AuthCommand = (typeof AUTH_COMMANDS)[number];

export type AuthAnswer = { value: unknown } | { error: AuthWireError };
export type AuthAnswers = Partial<Record<AuthCommand, AuthAnswer>>;

interface Tokens {
  jwt_token: string;
  refresh_token: string;
  wrapped_user_secrets?: string;
}

const session = (t: Tokens) => ({ jwt: t.jwt_token, refresh_token: t.refresh_token, wrapped_user_secrets: t.wrapped_user_secrets ?? null });

export const authWireError = {
  refused: (status: number, code?: string): AuthWireError => ({ kind: "status", status, ...(code ? { code } : {}) }),
  network: (message: string): AuthWireError => ({ kind: "network", message }),
};

/** What the Rust auth_* commands resolve or reject with. */
export const authAnswer = {
  accountId: (id: string): AuthAnswer => ({ value: id }),
  signedIn: (t: Tokens): AuthAnswer => ({ value: { kind: "signed", ...session(t) } }),
  session: (t: Tokens): AuthAnswer => ({ value: session(t) }),
  secondFactor: (pendingToken: string, methods: string[]): AuthAnswer => ({
    value: { kind: "secondFactor", pending_token: pendingToken, methods },
  }),
  passkeyUrl: (url: string): AuthAnswer => ({ value: url }),
  refused: (status: number, code?: string): AuthAnswer => ({ error: authWireError.refused(status, code) }),
  network: (message: string): AuthAnswer => ({ error: authWireError.network(message) }),
};

/** Answers an auth_* invoke from `answers`; an auth command the test left unanswered fails loudly. */
export function routeAuthCommand(answers: AuthAnswers, cmd: string): { handled: boolean; value?: unknown } {
  if (!(AUTH_COMMANDS as readonly string[]).includes(cmd)) return { handled: false };
  const answer = answers[cmd as AuthCommand];
  if (!answer) throw new Error(`test gave no answer for ${cmd}`);
  if ("error" in answer) throw answer.error;
  return { handled: true, value: answer.value };
}
