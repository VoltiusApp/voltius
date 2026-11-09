import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { invoke } from "@tauri-apps/api/core";
import {
  ErrorMsg,
  FormNote,
  INPUT_CLASS,
  Input,
  MasterPasswordNote,
  SubmitBtn,
  SwitchModeLink,
  emailError,
  newPasswordProblem,
} from "@/components/layout/authParts";
import { ServerUrlField } from "@/components/shared/ServerUrlField";
import { TwoFactorStep, useTwoFactorChallenge } from "@/components/shared/TwoFactorStep";
import { createServerAccount, getAccountId, login } from "@/services/account";
import { accountErrorText } from "@/services/accountErrors";
import {
  emailDomainAllowed,
  enrollmentCredential,
  joinRefusal,
  redeemEnrollment,
  resolveFailure,
  type EnrollmentOutcome,
  type ResolvedEnrollment,
  type ResolveFailure,
} from "@/services/enrollment/enrollmentPublic";
import type { EnrollmentTokenParts } from "@/services/enrollment/enrollmentToken";
import { serverAllowed } from "@/services/policy/serverPolicy";
import { accountKey, useEnrollmentStore } from "@/stores/enrollmentStore";
import type { EnrollSource } from "@/stores/uiStore";
import { enrollAuthStep, type EnrollAuthResult } from "@/services/enrollment/enrollAuth";
import { DEFAULT_SERVER_URL, instanceLabel, sameServer } from "@/utils/serverInstance";
import { Heading, StateCard, type CardAction } from "./enrollCards";

type Mode = "signup" | "signin";
export type EnrollActiveAccount = "none" | "local" | { serverUrl: string; accountId: string; email: string };
export type EnrollAuth = (req: { mode: Mode; email: string; password: string; token: EnrollmentTokenParts }) => Promise<EnrollAuthResult>;

const activeSession = async (outcome: EnrollmentOutcome | null): Promise<EnrollAuthResult> =>
  ({ outcome, session: "active", accountId: (await getAccountId()) ?? "" });

const firstLaunchAuth: EnrollAuth = ({ mode, email, password, token }) =>
  mode === "signup"
    ? enrollAuthStep(() => createServerAccount(email, password, token.serverUrl, enrollmentCredential(token)), activeSession)
    : enrollAuthStep(() => login(password, email, token.serverUrl), () => activeSession(null));

type Failure = ResolveFailure | "blocked";
type Step =
  | { kind: "loading" }
  | { kind: "failed"; failure: Failure; team?: string }
  | { kind: "confirm" | "form"; resolved: ResolvedEnrollment };

function failureBody(failure: Failure, team: string | undefined, host: string, t: (k: string, o?: Record<string, unknown>) => string) {
  switch (failure) {
    case "blocked": return t("common.policy.serverBlocked");
    case "notFound":
    case "gone": return t("layout.enroll.error.gone");
    case "lapsed": return team ? t("layout.enroll.error.lapsed", { team }) : t("layout.enroll.error.lapsedNoTeam");
    case "invitesOff": return t("common.error.teamInvitesDisabled");
    case "unreachable": return t("layout.enroll.error.unreachable", { host });
    default: return t(`layout.enroll.error.${failure}`);
  }
}

export interface EnrollFormProps {
  token: EnrollmentTokenParts;
  source: EnrollSource;
  host: "page" | "modal";
  passwordMode?: "new" | "current" | "none";
  activeAccount: EnrollActiveAccount;
  onDone: (outcome: EnrollmentOutcome, result: { email: string; teamName: string }) => void;
  onSkip?: () => void;
  auth?: EnrollAuth;
}

export function EnrollForm({ token, source, host, passwordMode = "new", activeAccount, onDone, onSkip, auth = firstLaunchAuth }: EnrollFormProps) {
  const { t } = useTranslation();
  const known = typeof activeAccount === "object" && sameServer(activeAccount.serverUrl, token.serverUrl) ? activeAccount : null;
  const [step, setStep] = useState<Step>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState<Mode>(known ? "signin" : "signup");
  const [email, setEmail] = useState(known?.email ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [emailInvalid, setEmailInvalid] = useState(false);
  const [loading, setLoading] = useState(false);
  const authed = useRef<EnrollAuthResult | null>(null);
  const twoFactor = useTwoFactorChallenge();
  const serverHost = instanceLabel(token.serverUrl) ?? DEFAULT_SERVER_URL;

  useEffect(() => {
    // Checked before resolve: the token secret must never reach a server this machine's policy blocks.
    if (!serverAllowed(token.serverUrl)) {
      setStep({ kind: "failed", failure: "blocked" });
      return;
    }
    let live = true;
    setStep({ kind: "loading" });
    useEnrollmentStore.getState().resolve(token, { force: true }).then(
      (resolved) => {
        if (!live) return;
        setStep({ kind: source === "machine" ? "form" : "confirm", resolved });
        const [domain] = resolved.allowedDomains;
        if (known || !domain) return;
        void invoke<string | null>("os_user_name").catch(() => null).then((name) => {
          if (live && name) setEmail((current) => current || `${name}@${domain}`);
        });
      },
      (e) => live && setStep({ kind: "failed", failure: resolveFailure(e) }),
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-resolve only for a new token or Retry
  }, [token, source, attempt]);

  const skipLabel = host === "page" ? t("layout.enroll.skip") : t("common.action.cancel");

  if (step.kind === "loading") {
    return (
      <div role="status" aria-label={t("layout.enroll.resolving")} className="flex justify-center py-8 text-(--t-text-dim)">
        <Icon icon="lucide:loader-circle" width={20} className="animate-spin" />
      </div>
    );
  }

  if (step.kind === "failed") {
    const actions: CardAction[] = [];
    if (step.failure === "unreachable") actions.push({ label: t("common.action.retry"), onClick: () => setAttempt((n) => n + 1) });
    if (onSkip) actions.push({ label: skipLabel, onClick: onSkip, primary: actions.length === 0 });
    return (
      <StateCard
        icon="lucide:link-2-off"
        color="var(--t-status-error)"
        title={t("layout.enroll.error.title")}
        body={failureBody(step.failure, step.team, serverHost, t)}
        actions={actions}
      >
        <p className="mb-4 text-center text-xs text-(--t-text-dim) truncate">{t("layout.auth.serverNamed", { host: serverHost })}</p>
      </StateCard>
    );
  }

  const { resolved } = step;
  const team = resolved.teamName;

  if (step.kind === "confirm") {
    const actions: CardAction[] = [{ label: t("layout.enroll.continue"), onClick: () => setStep({ kind: "form", resolved }) }];
    if (onSkip) actions.push({ label: t("common.action.cancel"), onClick: onSkip, primary: false });
    return (
      <StateCard
        icon="lucide:shield-alert"
        color="var(--t-status-warning)"
        title={t("layout.enroll.confirm.title", { team, host: serverHost })}
        body={t("layout.enroll.confirm.body", { host: serverHost })}
        actions={actions}
      />
    );
  }

  if (twoFactor.challenge) {
    return <TwoFactorStep challenge={twoFactor.challenge} onCancel={twoFactor.cancel} inputClassName={INPUT_CLASS} />;
  }

  const signup = mode === "signup";
  const domains = resolved.allowedDomains.map((d) => `@${d}`).join(", ");
  const domainError = t("layout.enroll.domainError", { team, domains });

  const fail = (message: string, onEmail = false) => {
    setError(message);
    setEmailInvalid(onEmail);
  };

  const refused = (e: unknown) => {
    const refusal = joinRefusal(e);
    if (refusal === "domainMismatch") return fail(domainError, !authed.current);
    if (refusal) return setStep({ kind: "failed", failure: refusal, team });
    fail(accountErrorText(e, t));
  };

  const finish = async (result: EnrollAuthResult | undefined) => {
    if (!result) throw new Error("enrol sign-in resumed without a result");
    authed.current = result;
    try {
      const outcome = result.outcome ?? (await redeemEnrollment(token, result.session));
      useEnrollmentStore.getState().record(token.id, accountKey(token.serverUrl, result.accountId), outcome);
      onDone(outcome, { email, teamName: team });
    } catch (e) {
      refused(e);
    }
  };

  const problem = (): [string, boolean] | null => {
    const invalidEmail = emailError(email, t);
    if (invalidEmail) return [invalidEmail, true];
    if (!emailDomainAllowed(email, resolved.allowedDomains)) return [domainError, true];
    const invalidPassword = signup && passwordMode === "new" ? newPasswordProblem(password, confirm, t) : "";
    if (invalidPassword) return [invalidPassword, false];
    if (signup && passwordMode === "current" && !password) return [t("layout.cloudAuthModal.errorPasswordRequired"), false];
    return null;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const invalid = authed.current ? null : problem();
    if (invalid) return fail(...invalid);
    fail("");
    setLoading(true);
    try {
      const prior = authed.current;
      await twoFactor.run(() => (prior ? Promise.resolve(prior) : auth({ mode, email, password, token })), finish);
    } catch (err) {
      refused(err);
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    fail("");
    setConfirm("");
  };

  const locked = authed.current !== null;
  const passwordPlaceholder = !signup
    ? t("layout.auth.masterPasswordPlaceholder")
    : passwordMode === "current"
      ? t("layout.enroll.currentPasswordPlaceholder")
      : t("layout.auth.masterPasswordMinPlaceholder");

  return (
    <div className="w-full">
      <Heading title={t("layout.enroll.title", { team })} body={t("layout.enroll.subtitle", { team })} />
      <form onSubmit={submit} className="w-full space-y-2">
        <Input type="email" placeholder={t("layout.auth.emailPlaceholder")} value={email} invalid={emailInvalid} disabled={locked}
          onChange={(v) => { setEmail(v); setEmailInvalid(false); }} />
        {(!signup || passwordMode !== "none") && (
          <Input type="password" placeholder={passwordPlaceholder} value={password} onChange={setPassword} disabled={locked} autoFocus />
        )}
        {signup && passwordMode === "new" && (
          <>
            <Input type="password" placeholder={t("layout.auth.confirmPasswordPlaceholder")} value={confirm} onChange={setConfirm} disabled={locked} />
            <MasterPasswordNote />
          </>
        )}
        {(domains || resolved.requireApproval) && (
          <div className="pt-1">
            {domains && <FormNote icon="lucide:at-sign">{t("layout.enroll.domainNote", { domains })}</FormNote>}
            {resolved.requireApproval && <FormNote icon="lucide:user-check">{t("layout.enroll.approvalNote")}</FormNote>}
          </div>
        )}
        <div className="pt-1">
          <ServerUrlField value={token.serverUrl} onChange={() => {}} inputClassName={INPUT_CLASS} locked
            lockedNote={source === "machine" ? t("layout.enroll.orgServer") : null} />
        </div>
        <ErrorMsg msg={error} />
        <SubmitBtn loading={loading} label={signup ? t("layout.enroll.createAndJoin") : t("layout.enroll.signInAndJoin")} />
      </form>
      {!locked && (signup
        ? <SwitchModeLink prompt={t("layout.auth.alreadyHaveAccount")} label={t("layout.auth.signIn")} onClick={() => switchMode("signin")} />
        : <SwitchModeLink prompt={t("layout.auth.newHere")} label={t("layout.auth.createAccount")} onClick={() => switchMode("signup")} />)}
      {onSkip && (
        <button type="button" onClick={onSkip}
          className="focus-ring mt-1 text-xs w-full text-center transition-colors text-(--t-text-dim) hover:text-(--t-text-primary)">
          {skipLabel}
        </button>
      )}
    </div>
  );
}
