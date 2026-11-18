/**
 * The auto-lock choices, shared by the settings control that changes them and
 * the account menu that reports the current one — one list, one set of labels.
 */
export const IMMEDIATELY = 0;

const TIMEOUT_LABEL_KEYS: Record<string, string> = {
  never: "never",
  "0": "immediately",
  "5": "5min",
  "15": "15min",
  "30": "30min",
  "60": "1h",
  "240": "4h",
};

type Translate = (key: string, options?: { count: number }) => string;

export function sessionTimeoutValue(minutes: number | null): string {
  return minutes === null ? "never" : String(minutes);
}

export function sessionTimeoutLabel(t: Translate, value: string): string {
  const key = TIMEOUT_LABEL_KEYS[value];
  if (key) return t(`settings.account.sessionSecurity.timeout.${key}`);
  const count = Number(value);
  return Number.isFinite(count)
    ? t("settings.account.sessionSecurity.timeout.minutes", { count })
    : t("settings.account.sessionSecurity.timeout.never");
}

export function sessionTimeoutOptions(t: Translate): { value: string; label: string }[] {
  return Object.keys(TIMEOUT_LABEL_KEYS).map((value) => ({ value, label: sessionTimeoutLabel(t, value) }));
}
