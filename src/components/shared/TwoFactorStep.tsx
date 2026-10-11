import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { PasskeyCancelledError, cancelPasskeyRoundTrip, passkeyRoundTrip } from "@/services/passkeyRoundTrip";
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

/** Tracks a passkey ceremony so a form can say the browser has the user, and stay quiet when they give up. */
export function usePasskeyCeremony() {
  const [waiting, setWaiting] = useState(false);
  const track = async <T,>(ceremony: () => Promise<T>): Promise<T> => {
    setWaiting(true);
    try {
      return await ceremony();
    } finally {
      setWaiting(false);
    }
  };
  return { waiting, track };
}

const PROMPTS = {
  typed: { code: "layout.twoFactor.prompt", recovery: "layout.twoFactor.recoveryPrompt" },
  passkey: { code: "layout.twoFactor.passkeyOrCodePrompt", recovery: "layout.twoFactor.passkeyOrRecoveryPrompt" },
} as const;

export const wasCancelled = (err: unknown): boolean => err instanceof PasskeyCancelledError;

export function PasskeyWaiting() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-2 py-2">
      <p className="flex items-center gap-2 text-xs text-(--t-text-muted)">
        <Icon icon="lucide:loader-circle" width={14} className="animate-spin shrink-0" />
        {t("layout.twoFactor.passkeyWaiting")}
      </p>
      <button type="button" onClick={cancelPasskeyRoundTrip} className="text-xs text-(--t-accent) hover:underline">
        {t("common.action.cancel")}
      </button>
    </div>
  );
}

export function TwoFactorField({ entry, onChange, inputClassName, autoFocus, methods = ALL_METHODS, passkey }: {
  entry: TwoFactorEntry;
  onChange: (entry: TwoFactorEntry) => void;
  inputClassName: string;
  autoFocus?: boolean;
  /** What the server will accept; a server that lost its seed key offers recovery codes only. */
  methods?: TwoFactorMethod[];
  passkey?: { start: () => void; waiting: boolean };
}) {
  const { t } = useTranslation();
  const recovery = entry.recovery || !methods.includes("totp");
  const canSwitch = methods.includes("totp") && methods.includes("recovery");
  if (passkey?.waiting) return <PasskeyWaiting />;
  return (
    <>
      {passkey && methods.includes("passkey") && (
        <button
          type="button"
          onClick={passkey.start}
          className="btn btn-secondary w-full py-1.5 rounded-lg text-sm flex items-center justify-center gap-2"
        >
          <Icon icon="lucide:fingerprint" width={14} />
          {t("layout.twoFactor.usePasskey")}
        </button>
      )}
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
  passkey: () => Promise<TwoFactorProof>;
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
      setChallenge({
        methods: step.methods,
        resume: (proof) => run(() => step.complete(proof), after),
        passkey: async () => ({ passkeyCode: await passkeyRoundTrip(step.openPasskey) }),
      });
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
  const { waiting, track } = usePasskeyCeremony();
  const { methods } = challenge;
  const recovery = entry.recovery || !methods.includes("totp");

  const attempt = async (getProof: () => Promise<TwoFactorProof | null>) => {
    setLoading(true);
    setError("");
    try {
      const proof = await getProof();
      if (proof) await challenge.resume(proof);
    } catch (err) {
      if (!wasCancelled(err)) setError(err instanceof Error ? err.message : String(err));
      setEntry({ recovery, value: "" });
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void attempt(async () => entryProof({ recovery, value: entry.value }));
  };

  return (
    <form onSubmit={onSubmit} className="w-full space-y-2">
      <p className="text-xs text-center text-(--t-text-muted) leading-relaxed">
        {t(PROMPTS[methods.includes("passkey") ? "passkey" : "typed"][recovery ? "recovery" : "code"])}
      </p>
      <TwoFactorField
        entry={entry}
        onChange={setEntry}
        inputClassName={inputClassName}
        methods={methods}
        autoFocus
        passkey={{ start: () => void attempt(() => track(challenge.passkey)), waiting }}
      />
      {error && <p className="text-xs text-center py-1 text-(--t-status-error)">{error}</p>}
      <button
        type="submit"
        hidden={waiting}
        disabled={loading || !entry.value.trim()}
        className={`btn btn-primary w-full rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60 ${buttonClassName}`}
      >
        {loading && <Icon icon="lucide:loader-circle" width={14} className="animate-spin" />}
        {t("layout.twoFactor.verify")}
      </button>
      <button
        type="button"
        hidden={waiting}
        onClick={onCancel}
        className={`btn btn-ghost w-full rounded-lg text-sm ${buttonClassName}`}
      >
        {t("common.action.cancel")}
      </button>
    </form>
  );
}
