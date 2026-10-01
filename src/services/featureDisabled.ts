import i18n from "@/i18n";

const MESSAGE_KEYS: Record<string, string> = {
  REGISTRATION_DISABLED: "common.error.registrationDisabled",
  TEAM_INVITES_DISABLED: "common.error.teamInvitesDisabled",
};

/** The server's 403 for a feature its operator switched off, or null for any other refusal. */
export async function featureDisabledError(res: { status: number; json?: () => Promise<unknown> }): Promise<Error | null> {
  if (res.status !== 403 || !res.json) return null;
  const body = await res.json().catch(() => null);
  const code = (body as { error?: unknown } | null)?.error;
  const key = typeof code === "string" ? MESSAGE_KEYS[code] : undefined;
  return key ? new Error(i18n.t(key)) : null;
}
