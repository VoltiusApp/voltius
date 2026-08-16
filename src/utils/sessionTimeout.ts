/**
 * The auto-lock choices, shared by the settings control that changes them and
 * the account menu that reports the current one — one list, one set of labels.
 */
const TIMEOUT_LABEL_KEYS: Record<string, string> = {
  never: "never",
  "5": "5min",
  "15": "15min",
  "30": "30min",
  "60": "1h",
  "240": "4h",
};

type Translate = (key: string) => string;

export function sessionTimeoutValue(minutes: number | null): string {
  return minutes === null ? "never" : String(minutes);
}

export function sessionTimeoutLabel(t: Translate, value: string): string {
  return t(`settings.account.sessionSecurity.timeout.${TIMEOUT_LABEL_KEYS[value] ?? "never"}`);
}

export function sessionTimeoutOptions(t: Translate): { value: string; label: string }[] {
  return Object.keys(TIMEOUT_LABEL_KEYS).map((value) => ({ value, label: sessionTimeoutLabel(t, value) }));
}
