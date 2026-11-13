import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, ModalCard } from "@/components/shared/Modal";
import { ErrorMsg } from "@/components/layout/authParts";
import { useLocalUpgrade } from "@/components/layout/useLocalUpgrade";
import { authenticateServerAccount, getAccountId, getCurrentUserEmail } from "@/services/account";
import { accountErrorText } from "@/services/accountErrors";
import { getServerUrl } from "@/services/authTokens";
import { enrollAuthStep } from "@/services/enrollment/enrollAuth";
import { enrollmentCredential, type EnrollmentOutcome } from "@/services/enrollment/enrollmentPublic";
import { addAccount, type SavedAccount } from "@/services/savedAccounts";
import { useTeamStore } from "@/stores/teamStore";
import { useUIStore, type EnrollTarget } from "@/stores/uiStore";
import { isNoAccountMode } from "@/utils/accountMode";
import { activeAccountAuth, EnrollForm, type EnrollAuth } from "./EnrollForm";
import { EnrollOutcome } from "./EnrollOutcome";

type ServerSession = { serverUrl: string; accountId: string; email: string };
type NewAccount = Omit<SavedAccount, "mode">;
type Done = { outcome: EnrollmentOutcome; email: string; teamName: string; account: NewAccount | null };

const orNull = <T,>(p: Promise<T>) => p.catch(() => null);
const sessionOf = (account: NewAccount) => ({ serverUrl: account.server_url ?? "", jwt: account.jwt ?? "" });

export default function EnrollModal() {
  const target = useUIStore((s) => s.enrollTarget);
  const opened = useRef<{ target: EnrollTarget | null; id: number }>({ target: null, id: 0 });
  if (opened.current.target !== target) opened.current = { target, id: opened.current.id + 1 };
  // Each open is its own mount, so a result arriving after close never reaches a later open.
  return target ? <EnrollModalBody key={opened.current.id} target={target} /> : null;
}

function EnrollModalBody({ target }: { target: EnrollTarget }) {
  const { t } = useTranslation();
  const closeEnroll = useUIStore((s) => s.closeEnroll);
  const teams = useTeamStore((s) => s.teams);
  const upgrade = useLocalUpgrade(true);
  const [session, setSession] = useState<ServerSession | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState("");
  const signedIn = useRef<NewAccount | null>(null);
  const leaving = useRef(false);
  const busy = useRef(false);
  const onBusyChange = useCallback((value: boolean) => { busy.current = value; }, []);

  useEffect(() => {
    let live = true;
    void Promise.all([orNull(getServerUrl()), orNull(getAccountId()), orNull(getCurrentUserEmail())]).then(
      ([serverUrl, accountId, email]) => live && setSession({ serverUrl: serverUrl ?? "", accountId: accountId ?? "", email: email ?? "" }),
    );
    return () => { live = false; };
  }, []);

  if (!session || !upgrade.ready) return null;

  const local = isNoAccountMode(upgrade.accountMode);

  const localAuth = activeAccountAuth({
    create: ({ email, password, token }) => upgrade.link(email, token.serverUrl, password, { enrollment: enrollmentCredential(token) }),
    signIn: ({ email, password, token }) => upgrade.signIn(email, token.serverUrl, password),
  });

  // The company account stays off this device until it has joined; the active one is untouched.
  const otherAccountAuth: EnrollAuth = ({ mode, email, password, token }) =>
    enrollAuthStep(
      () => authenticateServerAccount(mode === "signup" ? "register" : "signin", email, password, token.serverUrl, { enrollment: enrollmentCredential(token) }),
      async ({ account, enrollment }) => {
        signedIn.current = account;
        return { outcome: enrollment, session: sessionOf(account), accountId: account.account_id ?? "" };
      },
    );

  const leave = async () => {
    if (leaving.current || busy.current) return;
    leaving.current = true;
    const account = done?.account;
    if (account && account.account_id !== session.accountId) {
      try {
        await addAccount(account);
      } catch (e) {
        leaving.current = false;
        setError(accountErrorText(e, t));
        return;
      }
    }
    closeEnroll();
  };

  return (
    <Modal onClose={() => void leave()} blur>
      <ModalCard className="flex flex-col p-6" style={{ width: "min(27rem, 92vw)" }}>
        {done ? (
          <EnrollOutcome outcome={done.outcome} email={done.email} teamName={done.teamName} session={done.account ? sessionOf(done.account) : undefined}
            onContinue={() => void leave()} />
        ) : (
          <EnrollForm
            key={target.token.id}
            token={target.token}
            source={target.source}
            host="modal"
            passwordMode={local ? upgrade.passwordMode : "new"}
            activeAccount={local ? "local" : { ...session, teamIds: teams.map((team) => team.id) }}
            auth={local ? localAuth : otherAccountAuth}
            onDone={(outcome, result) => setDone({ outcome, ...result, account: signedIn.current })}
            onSkip={() => void leave()}
            onBusyChange={onBusyChange}
          />
        )}
        <ErrorMsg msg={error} />
      </ModalCard>
    </Modal>
  );
}
