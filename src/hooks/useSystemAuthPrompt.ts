import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { systemAuthAvailable, systemAuthVerify, type VerifyOutcome } from "@/services/appLock";

export function systemAuthMethodKey(platform: string | null): string {
  switch (platform) {
    case "windows": return "settings.account.sessionSecurity.systemAuth.method.windows";
    case "macos": return "settings.account.sessionSecurity.systemAuth.method.macos";
    case "android": return "settings.account.sessionSecurity.systemAuth.method.android";
    default: return "settings.account.sessionSecurity.systemAuth.method.linux";
  }
}

/** Shows the OS prompt once when the lock surface mounts; later attempts are the user's. */
export function useSystemAuthPrompt(enabled: boolean, onOk: () => void) {
  const { t } = useTranslation();
  const [available, setAvailable] = useState(false);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<VerifyOutcome | null>(null);
  const autoPrompted = useRef(false);
  const busyRef = useRef(false);

  const prompt = () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    void systemAuthVerify(t("layout.appLock.promptReason")).then((r) => {
      busyRef.current = false;
      setBusy(false);
      setOutcome(r);
      if (r === "unavailable") setAvailable(false);
      if (r === "ok") onOk();
    });
  };

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let ready = false;
    // An OS prompt raised while the app is hidden or unfocused is never seen, or never returns.
    const promptWhenPresent = () => {
      if (!alive || !ready || autoPrompted.current) return;
      if (document.visibilityState !== "visible" || !document.hasFocus()) return;
      autoPrompted.current = true;
      prompt();
    };
    void systemAuthAvailable().then((ok) => {
      if (!alive) return;
      setAvailable(ok);
      setChecked(true);
      ready = ok;
      promptWhenPresent();
    });
    window.addEventListener("focus", promptWhenPresent);
    document.addEventListener("visibilitychange", promptWhenPresent);
    return () => {
      alive = false;
      window.removeEventListener("focus", promptWhenPresent);
      document.removeEventListener("visibilitychange", promptWhenPresent);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- prompt once per mount
  }, [enabled]);

  return { available: enabled && available, checked: !enabled || checked, busy, outcome, prompt };
}

export type SystemAuthPrompt = ReturnType<typeof useSystemAuthPrompt>;
