import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { TwoFactorRequiredError, type TwoFactorMethod, type TwoFactorProof } from "@/services/twoFactorProof";

export interface TwoFactorEntry {
  recovery: boolean;
  value: string;
}

export const EMPTY_TWO_FACTOR_ENTRY: TwoFactorEntry = { recovery: false, value: "" };

export function entryProof(entry: TwoFactorEntry): TwoFactorProof | null {
  const value = entry.value.trim();
  if (!value) return null;
  return entry.recovery ? { recoveryCode: value } : { code: value };
}

const ALL_METHODS: TwoFactorMethod[] = ["totp", "recovery"];

export function TwoFactorField({ entry, onChange, inputClassName, autoFocus, methods = ALL_METHODS }: {
  entry: TwoFactorEntry;
  onChange: (entry: TwoFactorEntry) => void;
  inputClassName: string;
  autoFocus?: boolean;
  /** What the server will accept; a server that lost its seed key offers recovery codes only. */
  methods?: TwoFactorMethod[];
}) {
  const { t } = useTranslation();
  const recovery = entry.recovery || !methods.includes("totp");
  const canSwitch = methods.includes("totp") && methods.includes("recovery");
  return (
    <>
      <input
        key={recovery ? "recovery" : "totp"}
        type="text"
        value={entry.value}
        onChange={(e) => onChange({ recovery, value: e.target.value })}
        autoFocus={autoFocus}
        autoComplete={recovery ? "off" : "one-time-code"}
        inputMode={recovery ? "text" : "numeric"}
        autoCapitalize="none"
        spellCheck={false}
        maxLength={recovery ? 32 : 8}
        placeholder={recovery ? t("layout.twoFactor.recoveryPlaceholder") : t("layout.twoFactor.codePlaceholder")}
        className={`${inputClassName} font-mono tracking-wider`}
      />
      {canSwitch && (
        <button
          type="button"
          onClick={() => onChange({ recovery: !recovery, value: "" })}
          className="text-xs text-(--t-accent) hover:underline"
        >
          {recovery ? t("layout.twoFactor.useCode") : t("layout.twoFactor.useRecovery")}
        </button>
      )}
    </>
  );
}

export interface TwoFactorChallenge {
  methods: TwoFactorMethod[];
  /** Rejects with the message to show; resolving means the sign-in went through. */
  resume: (proof: TwoFactorProof) => Promise<void>;
}

/**
 * Runs a sign-in and what follows it. When the server asks for a code in
 * between, `challenge` is set and resuming it runs the same follow-up.
 */
export function useTwoFactorChallenge() {
  const [challenge, setChallenge] = useState<TwoFactorChallenge | null>(null);
  const run = async <T,>(work: () => Promise<T>, after: (result: T) => Promise<void> | void): Promise<void> => {
    try {
      await after(await work());
      setChallenge(null);
    } catch (e) {
      if (!(e instanceof TwoFactorRequiredError)) throw e;
      const step = e as TwoFactorRequiredError<T>;
      setChallenge({ methods: step.methods, resume: (proof) => run(() => step.complete(proof), after) });
    }
  };
  return { challenge, run, cancel: () => setChallenge(null) };
}

/** The code form a sign-in falls into when the account has two-factor on. */
export function TwoFactorStep({ challenge, onCancel, inputClassName, buttonClassName = "py-2" }: {
  challenge: TwoFactorChallenge;
  onCancel: () => void;
  inputClassName: string;
  buttonClassName?: string;
}) {
  const { t } = useTranslation();
  const [entry, setEntry] = useState<TwoFactorEntry>(EMPTY_TWO_FACTOR_ENTRY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { methods } = challenge;
  const recovery = entry.recovery || !methods.includes("totp");

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const proof = entryProof({ recovery, value: entry.value });
    if (!proof) return;
    setLoading(true);
    setError("");
    try {
      await challenge.resume(proof);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setEntry({ recovery, value: "" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="w-full space-y-2">
      <p className="text-xs text-center text-(--t-text-muted) leading-relaxed">
        {recovery ? t("layout.twoFactor.recoveryPrompt") : t("layout.twoFactor.prompt")}
      </p>
      <TwoFactorField entry={entry} onChange={setEntry} inputClassName={inputClassName} methods={methods} autoFocus />
      {error && <p className="text-xs text-center py-1 text-(--t-status-error)">{error}</p>}
      <button
        type="submit"
        disabled={loading || !entry.value.trim()}
        className={`btn btn-primary w-full rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60 ${buttonClassName}`}
      >
        {loading && <Icon icon="lucide:loader-circle" width={14} className="animate-spin" />}
        {t("layout.twoFactor.verify")}
      </button>
      <button type="button" onClick={onCancel} className={`btn btn-ghost w-full rounded-lg text-sm ${buttonClassName}`}>
        {t("common.action.cancel")}
      </button>
    </form>
  );
}
