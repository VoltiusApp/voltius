import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { DisclosureToggle, ErrorMsg, INPUT_CLASS, Input } from "@/components/layout/authParts";
import { roleLabel } from "@/components/members/roleChips";
import { resolveServerUrl } from "@/services/policy/serverPolicy";
import type { SignupCredential } from "@/services/account";
import {
  ExplainedInFormError, lookupInvitation, parseInvitationInput, RegistrationClosedError, type InvitationPreview,
} from "@/services/teamInvitation";

/** Sign-up with an emailed team invitation: the pasted link, checked against the server the form names. */
export function useInvitationSignup(serverUrl: string) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [closedHint, setClosedHint] = useState(false);
  const [text, setText] = useState("");
  const [checked, setChecked] = useState<InvitationPreview | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  const server = resolveServerUrl(serverUrl);
  // An invitation belongs to one server; editing the address afterwards drops it.
  const invitation = checked?.serverUrl === server ? checked : null;

  const check = async () => {
    const token = parseInvitationInput(text);
    if (!token) { setError(t("layout.auth.invitation.invalid")); return; }
    setChecking(true);
    setError("");
    try {
      const found = await lookupInvitation(server, token);
      if (found) setChecked(found);
      else setError(t("layout.auth.invitation.notFound", { server: new URL(server).host }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  };

  const credential: SignupCredential = invitation ? { invitation: invitation.token } : {};

  /** Opens the entry, with an explanation, when the server turns an open sign-up away. */
  const askOnClosed = <T,>(fn: () => Promise<T>) => () =>
    fn().catch((e: unknown) => {
      if (!(e instanceof RegistrationClosedError) || invitation) throw e;
      setOpen(true);
      setClosedHint(true);
      throw new ExplainedInFormError();
    });

  const entry = {
    open, closedHint, text, checking, error, invitation,
    toggle: () => setOpen((v) => !v),
    edit: (v: string) => { setText(v); setError(""); },
    check: () => void check(),
    remove: () => { setChecked(null); setText(""); },
  };

  /** The address to register: the invited one, read-only, once an invitation names it. */
  const email = (typed: string, registering: boolean) => {
    const locked = registering ? invitation?.email ?? null : null;
    return { value: locked ?? typed, locked: locked !== null };
  };

  const createLabel = invitation ? t("layout.auth.invitation.createAndJoin") : t("layout.auth.createAccount");

  return { invitation, credential, askOnClosed, email, createLabel, entry };
}

export type InvitationEntryState = ReturnType<typeof useInvitationSignup>["entry"];

export function InvitationEntry({ state, inputClassName = INPUT_CLASS }: { state: InvitationEntryState; inputClassName?: string }) {
  const { t } = useTranslation();
  const { invitation } = state;

  if (invitation) {
    return (
      <div className="flex items-start gap-2 rounded-lg px-3 py-2 border border-(--t-border) bg-(--t-bg-elevated)">
        <Icon icon="lucide:users" width={14} className="shrink-0 mt-0.5 text-(--t-accent)" />
        <div className="flex-1 min-w-0 text-xs leading-relaxed">
          <p className="font-medium text-(--t-text-primary)">{t("layout.auth.invitation.joining", { team: invitation.teamName })}</p>
          <p className="text-(--t-text-secondary)">
            {invitation.inviter
              ? t("layout.auth.invitation.invitedBy", { inviter: invitation.inviter, role: roleLabel(t, invitation.role) })
              : t("layout.auth.invitation.invitedAs", { role: roleLabel(t, invitation.role) })}
          </p>
        </div>
        <button type="button" onClick={state.remove} aria-label={t("layout.auth.invitation.remove")} title={t("layout.auth.invitation.remove")}
          className="focus-ring shrink-0 rounded p-0.5 text-(--t-text-dim) hover:text-(--t-text-primary)">
          <Icon icon="lucide:x" width={13} />
        </button>
      </div>
    );
  }

  return (
    <div>
      <DisclosureToggle open={state.open} onToggle={state.toggle} label={t("layout.auth.invitation.toggle")} align="start" />
      {state.open && (
        // Enter checks the link rather than submitting the sign-up around it.
        <div className="mt-2 space-y-2" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); state.check(); } }}>
          {state.closedHint && <p className="text-xs leading-relaxed text-(--t-text-secondary)">{t("layout.auth.invitation.closedHint")}</p>}
          <div className="flex gap-2">
            <div className="flex-1 min-w-0">
              <Input type="text" placeholder={t("layout.auth.invitation.placeholder")} value={state.text} autoFocus={state.closedHint}
                invalid={!!state.error} onChange={state.edit} className={`${inputClassName} font-mono`} />
            </div>
            <button type="button" onClick={state.check} disabled={state.checking || !state.text.trim()}
              className="btn btn-secondary shrink-0 px-3 rounded-lg text-xs font-medium disabled:opacity-60">
              {state.checking ? t("layout.auth.invitation.checking") : t("layout.auth.invitation.use")}
            </button>
          </div>
          <ErrorMsg msg={state.error} />
        </div>
      )}
    </div>
  );
}
