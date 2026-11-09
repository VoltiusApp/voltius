import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { invoke } from "@/lib/invoke";
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
import { createServerAccount, login } from "@/services/account";
import { accountErrorText } from "@/services/accountErrors";
import {
  atDomains,
  emailDomainAllowed,
  enrollFailureText,
  enrollmentCredential,
  joinRefusal,
  redeemEnrollment,
  resolveFailure,
  tokenHost,
  type EnrollmentOutcome,
  type ResolvedEnrollment,
  type ResolveFailure,
} from "@/services/enrollment/enrollmentPublic";
import type { EnrollmentTokenParts } from "@/services/enrollment/enrollmentToken";
import { accountKey, useEnrollmentStore } from "@/stores/enrollmentStore";
import type { EnrollSource } from "@/stores/uiStore";
import { activeEnrollSession, enrollAuthStep, type EnrollAuthResult } from "@/services/enrollment/enrollAuth";
import { getSavedAccounts } from "@/services/savedAccounts";
import { sameServer } from "@/utils/serverInstance";
import { Heading, StateCard, type CardAction } from "./enrollCards";

type Mode = "signup" | "signin";
export type EnrollActiveAccount = "none" | "local" | { serverUrl: string; accountId: string; email: string; teamIds?: string[] };
type AuthRequest = { mode: Mode; email: string; password: string; token: EnrollmentTokenParts };
export type EnrollAuth = (req: AuthRequest) => Promise<EnrollAuthResult>;

/** Sign-in that leaves the enrolled account as this device's active one. */
export const activeAccountAuth = ({ create, signIn }: {
  create: (req: AuthRequest) => Promise<EnrollmentOutcome | null>;
  signIn: (req: AuthRequest) => Promise<void>;
}): EnrollAuth => (req) =>
  req.mode === "signup"
    ? enrollAuthStep(() => create(req), activeEnrollSession)
    : enrollAuthStep(() => signIn(req), () => activeEnrollSession(null));

const firstLaunchAuth = activeAccountAuth({
  create: ({ email, password, token }) => createServerAccount(email, password, token.serverUrl, enrollmentCredential(token)),
  signIn: ({ email, password, token }) => login(password, email, token.serverUrl),
});

const savedEmailOn = (serverUrl: string): Promise<string | null> =>
  getSavedAccounts().then((accounts) => accounts.find((a) => a.email && sameServer(a.server_url, serverUrl))?.email ?? null, () => null);

type Step =
  | { kind: "loading" }
  | { kind: "failed"; failure: ResolveFailure; team?: string }
  | { kind: "already" | "confirm" | "join" | "form"; resolved: ResolvedEnrollment };

export interface EnrollFormProps {
  token: EnrollmentTokenParts;
  source: EnrollSource;
  host: "page" | "modal";
  passwordMode?: "new" | "current" | "none";
  activeAccount: EnrollActiveAccount;
  onDone: (outcome: EnrollmentOutcome, result: { email: string; teamName: string }) => void;
  onSkip?: () => void;
  onBusyChange?: (busy: boolean) => void;
  auth?: EnrollAuth;
}

export function EnrollForm({ token, source, host, passwordMode = "new", activeAccount, onDone, onSkip, onBusyChange, auth = firstLaunchAuth }: EnrollFormProps) {
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
  const [confirmReplace, setConfirmReplace] = useState(false);
  const authed = useRef<EnrollAuthResult | null>(null);
  const twoFactor = useTwoFactorChallenge();
  const serverHost = tokenHost(token.serverUrl);
  const local = activeAccount === "local";
  const pastConfirm = (resolved: ResolvedEnrollment): Step =>
    ({ kind: known && emailDomainAllowed(known.email, resolved.allowedDomains) ? "join" : "form", resolved });

  const working = loading || twoFactor.verifying;
  useEffect(() => {
    onBusyChange?.(working);
    return () => onBusyChange?.(false);
  }, [working, onBusyChange]);

  useEffect(() => {
    let live = true;
    setStep({ kind: "loading" });
    const saved = known ? Promise.resolve(null) : savedEmailOn(token.serverUrl);
    Promise.all([useEnrollmentStore.getState().resolve(token, { force: true }), saved]).then(
      ([resolved, savedEmail]) => {
        if (!live) return;
        if (known?.teamIds?.includes(resolved.teamId)) return setStep({ kind: "already", resolved });
        setStep(source === "machine" ? pastConfirm(resolved) : { kind: "confirm", resolved });
        if (savedEmail) {
          setMode("signin");
          setEmail(savedEmail);
          return;
        }
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
        body={enrollFailureText(step.failure, t, { team: step.team, host: serverHost })}
        actions={actions}
      >
        <p className="mb-4 text-center text-xs text-(--t-text-dim) truncate">{t("layout.auth.serverNamed", { host: serverHost })}</p>
      </StateCard>
    );
  }

  const { resolved } = step;
  const team = resolved.teamName;

  if (step.kind === "already") {
    return (
      <StateCard
        icon="lucide:circle-check-big"
        color="var(--t-status-connected)"
        title={t("layout.enroll.already.title", { team })}
        body={t("layout.enroll.already.body", { email: known?.email ?? "" })}
        actions={onSkip ? [{ label: t("common.action.close"), onClick: onSkip }] : []}
      />
    );
  }

  if (step.kind === "confirm") {
    const actions: CardAction[] = [{ label: t("layout.enroll.continue"), onClick: () => setStep(pastConfirm(resolved)) }];
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
  const domains = atDomains(resolved.allowedDomains);
  const domainError = enrollFailureText("domainMismatch", t, { team, host: serverHost, domains: resolved.allowedDomains });

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

  const problem = (): [string, boolean] | null => {
    const invalidEmail = emailError(email, t);
    if (invalidEmail) return [invalidEmail, true];
    if (!emailDomainAllowed(email, resolved.allowedDomains)) return [domainError, true];
    const invalidPassword = signup && passwordMode === "new" ? newPasswordProblem(password, confirm, t) : "";
    if (invalidPassword) return [invalidPassword, false];
    if (signup && passwordMode === "current" && !password) return [t("layout.cloudAuthModal.errorPasswordRequired"), false];
    return null;
  };

  const busy = async (work: () => Promise<void>) => {
    fail("");
    setLoading(true);
    try {
      await work();
    } catch (err) {
      refused(err);
    } finally {
      setLoading(false);
    }
  };

  const finish = (result: EnrollAuthResult | undefined) => busy(async () => {
    if (!result) throw new Error("enrol sign-in resumed without a result");
    authed.current = result;
    const outcome = result.outcome ?? (await redeemEnrollment(token, result.session));
    const store = useEnrollmentStore.getState();
    store.record(token.id, accountKey(token.serverUrl, result.accountId), outcome);
    if (result.session === "active") void store.loadMyRequests();
    onDone(outcome, { email, teamName: team });
  });

  const signIn = () => {
    const prior = authed.current;
    return busy(() => twoFactor.run(() => (prior ? Promise.resolve(prior) : auth({ mode, email, password, token })), finish));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const invalid = authed.current ? null : problem();
    if (invalid) return fail(...invalid);
    if (local && !signup && !authed.current) return setConfirmReplace(true);
    await signIn();
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    fail("");
    setConfirm("");
  };

  if (step.kind === "join" && known) {
    const useAnother = () => {
      authed.current = null;
      setEmail("");
      fail("");
      setStep({ kind: "form", resolved });
    };
    return (
      <StateCard
        icon="lucide:building-2"
        color="var(--t-accent)"
        title={t("layout.enroll.join.title", { team, email: known.email })}
        body={t("layout.enroll.join.body", { host: serverHost })}
        actions={[
          { label: t("layout.enroll.join.action"), onClick: () => void busy(async () => finish(await activeEnrollSession(null))), loading },
          { label: t("layout.enroll.join.other"), onClick: useAnother, primary: false, disabled: loading },
        ]}
      >
        <ErrorMsg msg={error} />
      </StateCard>
    );
  }

  if (confirmReplace) {
    return (
      <StateCard
        icon="lucide:triangle-alert"
        color="var(--t-status-warning)"
        title={t("layout.enroll.replace.title")}
        body={t("layout.enroll.replace.body", { email })}
        actions={[
          { label: t("layout.enroll.replace.confirm"), onClick: () => { setConfirmReplace(false); void signIn(); } },
          { label: t("common.action.cancel"), onClick: () => setConfirmReplace(false), primary: false },
        ]}
      />
    );
  }

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
        {(domains || resolved.requireApproval || (local && signup)) && (
          <div className="pt-1">
            {domains && <FormNote icon="lucide:at-sign">{t("layout.enroll.domainNote", { domains })}</FormNote>}
            {resolved.requireApproval && <FormNote icon="lucide:user-check">{t("layout.enroll.approvalNote")}</FormNote>}
            {local && signup && <FormNote icon="lucide:info">{t("layout.enroll.localNote", { team })}</FormNote>}
          </div>
        )}
        <div className="pt-1">
          <ServerUrlField value={token.serverUrl} onChange={() => {}} inputClassName={INPUT_CLASS} locked lockedHost={serverHost}
            lockedNote={source === "machine" ? t("layout.enroll.orgServer") : null} />
        </div>
        <ErrorMsg msg={error} />
        <SubmitBtn loading={loading} label={signup ? t("layout.enroll.createAndJoin") : t("layout.enroll.signInAndJoin")} />
      </form>
      {!locked && (signup
        ? <SwitchModeLink prompt={t("layout.auth.alreadyHaveAccount")} label={t("layout.auth.signIn")} onClick={() => switchMode("signin")} />
        : <SwitchModeLink prompt={t("layout.auth.newHere")} label={t("layout.auth.createAccount")} onClick={() => switchMode("signup")} />)}
      {onSkip && (
        <button type="button" onClick={onSkip} disabled={loading}
          className="focus-ring mt-1 text-xs w-full text-center transition-colors text-(--t-text-dim) hover:text-(--t-text-primary)">
          {skipLabel}
        </button>
      )}
    </div>
  );
}
