import { useEffect, useState } from "react";
import { getAccountMode, linkToCloud, setMasterPassword, signInToCloud, type SignupCredential } from "@/services/account";
import type { EnrollmentOutcome } from "@/services/enrollment/enrollmentPublic";
import { leaveLanGroup, startSessionSync } from "@/services/lanSync";
import { syncOnLogin, syncOnLoginReplace } from "@/services/sync";
import { afterSecondFactor } from "@/services/twoFactorProof";
import { secretState } from "@/services/vaultSecret";
import { useSubscriptionStore } from "@/stores/subscriptionStore";

export type UpgradePasswordMode = "new" | "current" | "none";

/** How this device's account moves onto a server: link it, or sign in over it. Reloaded each time `open` turns true. */
export function useLocalUpgrade(open: boolean) {
  const reloadSubscription = useSubscriptionStore((s) => s.load);
  const [accountMode, setAccountMode] = useState<string | null>(null);
  const [hasStoredPassword, setHasStoredPassword] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setReady(false);
    void Promise.all([
      getAccountMode().catch(() => null),
      secretState().then((s) => s !== "none", () => false),
    ]).then(([mode, stored]) => {
      if (!live) return;
      setAccountMode(mode);
      setHasStoredPassword(stored);
      setReady(true);
    });
    return () => { live = false; };
  }, [open]);

  // Linking derives the cloud account from the master password, so ask when this device holds no copy.
  const passwordMode: UpgradePasswordMode =
    accountMode === "local-nopassword" ? "new" : hasStoredPassword ? "none" : "current";

  const connected = async (firstSync: () => Promise<void>) => {
    startSessionSync(firstSync().catch(() => {}));
    await reloadSubscription().catch(() => {});
  };

  const link = async (email: string, serverUrl: string, password: string, credential?: SignupCredential): Promise<EnrollmentOutcome | null> => {
    if (passwordMode === "new") await setMasterPassword(password);
    const outcome = await linkToCloud(email, serverUrl, leaveLanGroup, passwordMode === "none" ? undefined : password, credential);
    await connected(syncOnLogin);
    return outcome;
  };

  const signIn = (email: string, serverUrl: string, password: string): Promise<void> =>
    afterSecondFactor(() => signInToCloud(email, password, serverUrl, leaveLanGroup), () => connected(syncOnLoginReplace));

  return { ready, accountMode, passwordMode, connected, link, signIn };
}
