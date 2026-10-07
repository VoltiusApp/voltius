import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ErrorMsg, Input, Layout, SubmitBtn, SystemAuthButton } from "./authParts";
import { getAccountMode, isCurrentMasterPassword } from "@/services/account";
import { resetVault } from "@/services/vault";
import { useSystemAuthPrompt } from "@/hooks/useSystemAuthPrompt";
import { useAppLockStore } from "@/stores/appLockStore";
import { useSecurityStore } from "@/stores/securityStore";
import { canLockVault } from "@/utils/accountMode";

const BLOCKED_EVENTS = ["keydown", "keyup", "keypress", "paste", "copy", "cut"] as const;
const KEY_EVENTS = ["keydown", "keyup", "keypress"] as const;
const EDITING_KEYS = new Set(["a", "c", "v", "x", "z"]);
const FIELD_KEYS = new Set(["Backspace", "Delete", "Enter", "Tab", "Escape", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Shift", "Control", "Meta", "Alt", "CapsLock"]);
const OVERLAY_ATTR = "data-app-lock";
const ABOVE_EVERYTHING = 10_000;

function guardWhileLocked(e: Event) {
  if (useAppLockStore.getState().kind !== "screen") return;
  const k = e as KeyboardEvent;
  const inside = e.target instanceof Element && e.target.closest(`[${OVERLAY_ATTR}]`);
  const typing = k.key === undefined || String(k.key).length === 1 || FIELD_KEYS.has(k.key);
  const shortcut = (k.ctrlKey || k.metaKey || k.altKey) && !EDITING_KEYS.has(String(k.key).toLowerCase());
  if (inside && typing && !shortcut) return;
  e.preventDefault();
  e.stopImmediatePropagation();
}

// Registered at import so it runs ahead of every capture listener the app adds later.
if (typeof window !== "undefined") {
  for (const name of BLOCKED_EVENTS) window.addEventListener(name, guardWhileLocked, { capture: true });
}

export default function AppLockOverlay() {
  const kind = useAppLockStore((s) => s.kind);
  if (kind !== "screen") return null;
  return <LockedScreen />;
}

function LockedScreen() {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const unlock = useAppLockStore((s) => s.unlock);
  const systemAuthUnlock = useSecurityStore((s) => s.systemAuthUnlock);
  const [mode, setMode] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const auth = useSystemAuthPrompt(systemAuthUnlock, () => void unlock());

  useEffect(() => { void getAccountMode().then(setMode).catch(() => setMode(null)); }, []);

  useEffect(() => {
    const overlay = rootRef.current;
    const hidden = Array.from(document.body.children)
      .filter((el) => el !== overlay && !el.hasAttribute("inert") && !el.hasAttribute("aria-hidden"));
    for (const el of hidden) {
      el.setAttribute("inert", "");
      el.setAttribute("aria-hidden", "true");
    }
    const keepInside = (e: Event) => e.stopPropagation();
    for (const name of KEY_EVENTS) overlay?.addEventListener(name, keepInside);
    return () => {
      for (const el of hidden) {
        el.removeAttribute("inert");
        el.removeAttribute("aria-hidden");
      }
      for (const name of KEY_EVENTS) overlay?.removeEventListener(name, keepInside);
    };
  }, []);

  const hasPassword = canLockVault(mode);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    if (await isCurrentMasterPassword(password)) await unlock();
    else setError(t("layout.appLock.wrongPassword"));
    setLoading(false);
  };

  return createPortal(
    <div
      ref={rootRef}
      {...{ [OVERLAY_ATTR]: "" }}
      role="dialog"
      aria-modal="true"
      aria-label={t("layout.appLock.title")}
      className="fixed inset-0"
      style={{ zIndex: ABOVE_EVERYTHING }}
    >
      <Layout>
        <p className="text-sm mb-1 text-center text-(--t-text-bright)">{t("layout.appLock.title")}</p>
        <p className="text-xs mb-4 text-center text-(--t-text-muted)">{t("layout.appLock.subtitle")}</p>
        <SystemAuthButton auth={auth} />
        {hasPassword && (
          <form onSubmit={submit} className="w-full space-y-2">
            <Input type="password" placeholder={t("layout.auth.masterPasswordPlaceholder")} value={password}
              onChange={setPassword} autoFocus={!systemAuthUnlock} />
            <ErrorMsg msg={error} />
            <SubmitBtn loading={loading} label={t("layout.auth.unlock")} />
          </form>
        )}
        {mode !== null && !hasPassword && auth.checked && !auth.available && (
          <button
            type="button"
            onClick={() => void resetVault().then(() => window.location.reload())}
            className="mt-1 text-xs w-full text-center transition-colors text-(--t-text-dim) hover:text-(--t-status-error)"
          >
            {t("layout.auth.resetVault")}
          </button>
        )}
      </Layout>
    </div>,
    document.body,
  );
}
