import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import qrcode from "qrcode-generator";
import { INPUT_CLASS } from "@/components/layout/authParts";
import {
  EMPTY_TWO_FACTOR_ENTRY, PasskeyWaiting, TwoFactorField, entryProof, usePasskeyCeremony, wasCancelled,
  type TwoFactorEntry,
} from "@/components/shared/TwoFactorStep";
import { useCopiedFlash } from "@/hooks/useCopiedFlash";
import { saveTextFile } from "@/services/saveFile";
import { useServerSecondFactors } from "@/services/serverCapabilities";
import {
  addPasskey, beginTwoFactorSetup, enableTwoFactor, factorMethods, getFactors, passkeyStepUp, regenerateRecoveryCodes,
  removeFactor, type FactorTarget, type Factors, type TwoFactorSetup,
} from "@/services/twoFactor";
import type { TwoFactorProof } from "@/services/twoFactorProof";
import { writeClipboard } from "@/utils/clipboard";
import { SHORT_DATE, formatDate } from "@/utils/localeFormat";
import { ActionItem, FormButtons, SettingsDialog, SettingsInput } from "./shared";

const QUIET_ZONE = 4;

function QrCode({ value, label }: { value: string; label: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    let d = "";
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (qr.isDark(row, col)) d += `M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`;
      }
    }
    return { size: count + QUIET_ZONE * 2, path: d };
  }, [value]);
  // Black on white whatever the theme: scanners need the contrast.
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${size} ${size}`} className="mx-auto rounded-lg" width={168} height={168}
      shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

type View =
  | { kind: "choose" }
  | { kind: "totp" }
  | { kind: "totpConfirm"; setup: TwoFactorSetup }
  | { kind: "passkey" }
  | { kind: "codes"; codes: string[] }
  | { kind: "manage" }
  | { kind: "passkeys" }
  | { kind: "regenerate" }
  | { kind: "remove"; target: FactorTarget };

type Offered = { totp: boolean; passkeys: boolean };

const NO_FACTORS: Factors = { totp: false, passkeys: [], recoveryCodesLeft: null };

const firstView = (enabled: boolean, offered: Offered): View =>
  enabled ? { kind: "manage" } : offered.totp && offered.passkeys ? { kind: "choose" } : { kind: offered.passkeys ? "passkey" : "totp" };

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { t } = useTranslation();
  const { copied, flash } = useCopiedFlash(1500);
  const text = codes.join("\n");
  return (
    <div className="space-y-3">
      <p className="text-xs text-(--t-text-dim) leading-relaxed">{t("settings.account.twoFactor.codesBody")}</p>
      <ul className="space-y-0.5 rounded-lg py-2 font-mono text-xs text-center bg-(--t-bg-input) border border-(--t-border) text-(--t-text-primary) select-text">
        {codes.map((code) => <li key={code}>{code}</li>)}
      </ul>
      <div className="flex gap-2">
        <button type="button" className="btn btn-secondary flex-1 py-1.5 rounded-lg text-sm"
          onClick={() => void writeClipboard(text).then(() => flash()).catch(() => {})}>
          {copied ? t("settings.account.twoFactor.copied") : t("settings.account.twoFactor.copy")}
        </button>
        <button type="button" className="btn btn-secondary flex-1 py-1.5 rounded-lg text-sm"
          onClick={() => void saveTextFile("voltius-recovery-codes.txt", `${text}\n`)}>
          {t("settings.account.twoFactor.save")}
        </button>
      </div>
      <button type="button" onClick={onDone} className="btn btn-primary w-full py-1.5 rounded-lg text-sm font-medium">
        {t("settings.account.twoFactor.saved")}
      </button>
    </div>
  );
}

function TwoFactorDialog({ enabled, offered, onChange, onClose }: {
  enabled: boolean;
  offered: Offered;
  onChange: (enabled: boolean) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<View>(() => firstView(enabled, offered));
  const [factors, setFactors] = useState<Factors | null>(enabled ? null : NO_FACTORS);
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [entry, setEntry] = useState<TwoFactorEntry>(EMPTY_TWO_FACTOR_ENTRY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { copied: keyCopied, flash: flashKey } = useCopiedFlash(1500);
  const passkey = usePasskeyCeremony();

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void getFactors(true)
      .then((held) => alive && setFactors(held))
      .catch((err) => alive && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      alive = false;
    };
  }, [enabled]);

  const held = factors ?? NO_FACTORS;
  const hasFactor = held.totp || held.passkeys.length > 0;

  const go = (next: View) => {
    setView(next);
    setEntry(EMPTY_TWO_FACTOR_ENTRY);
    setError("");
  };
  const home = () => go(firstView(hasFactor, offered));
  const leave = hasFactor || (offered.totp && offered.passkeys) ? home : onClose;

  /** Where a change lands: recovery codes when the account just got them, else the refreshed list. */
  const settle = async (stillOn: boolean, next: View, codes: string[] = []) => {
    onChange(stillOn);
    if (codes.length) return go({ kind: "codes", codes });
    if (!stillOn) return onClose();
    setFactors(await getFactors(true));
    go(next);
  };

  const attempt = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (err) {
      if (!wasCancelled(err)) setError(err instanceof Error ? err.message : String(err));
      setEntry((current) => ({ ...current, value: "" }));
    } finally {
      setBusy(false);
    }
  };

  /** Submit sends what was typed; with `proof`, the passkey button sends a passkey's answer instead. */
  const form = (
    work: (proof: TwoFactorProof | null) => Promise<void>,
    submitLabel: string,
    onCancel: () => void,
    children: ReactNode,
    proof: "typed" | "any" | "none" = "any",
  ) => (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void attempt(() => work(proof === "none" ? null : entryProof(entry)));
      }}
      className="space-y-2"
    >
      {passkey.waiting ? (
        <PasskeyWaiting />
      ) : (
        <>
          {children}
          {proof !== "none" && (
            <TwoFactorField
              entry={entry}
              onChange={setEntry}
              inputClassName={INPUT_CLASS}
              methods={proof === "typed" ? ["totp"] : factorMethods(held)}
              passkey={{ start: () => void attempt(async () => work(await passkey.track(passkeyStepUp))), waiting: false }}
            />
          )}
          {error && <p className="text-xs text-(--t-status-error)">{error}</p>}
          <FormButtons onCancel={onCancel} submitting={busy} submitLabel={submitLabel} />
        </>
      )}
    </form>
  );

  const hint = (text: string) => <p className="text-xs text-(--t-text-dim) leading-relaxed">{text}</p>;
  const passwordInput = (
    <SettingsInput type="password" placeholder={t("layout.auth.masterPasswordPlaceholder")} value={password}
      onChange={setPassword} autoFocus />
  );
  const signsOutOthers = !hasFactor && hint(t("settings.account.twoFactor.introDevices"));
  const existingProof = hasFactor ? "any" : "none";

  let body: ReactNode;
  switch (view.kind) {
    case "choose":
      body = (
        <div className="space-y-2">
          {hint(t("settings.account.twoFactor.intro"))}
          <ActionItem icon="lucide:smartphone" label={t("settings.account.twoFactor.authenticator")}
            sub={t("settings.account.twoFactor.authenticatorSub")} onClick={() => go({ kind: "totp" })} />
          <ActionItem icon="lucide:fingerprint" label={t("settings.account.twoFactor.passkey")}
            sub={t("settings.account.twoFactor.passkeySub")} onClick={() => go({ kind: "passkey" })} />
        </div>
      );
      break;
    case "totp":
      body = form(
        async (proof) => go({ kind: "totpConfirm", setup: await beginTwoFactorSetup(password, proof) }),
        t("settings.account.twoFactor.continue"), leave,
        <>
          {hint(t("settings.account.twoFactor.authenticatorIntro"))}
          {signsOutOthers}
          {passwordInput}
        </>,
        existingProof,
      );
      break;
    case "totpConfirm":
      body = form(
        async () => settle(true, { kind: "manage" }, await enableTwoFactor(entry.value)),
        t("settings.account.twoFactor.turnOn"), leave,
        <>
          {hint(t("settings.account.twoFactor.scan"))}
          <QrCode value={view.setup.otpauth_uri} label={t("settings.account.twoFactor.qrLabel")} />
          <button
            type="button"
            title={t("settings.account.twoFactor.copyKey")}
            onClick={() => void writeClipboard(view.setup.secret).then(() => flashKey()).catch(() => {})}
            className="w-full flex items-center justify-center gap-1.5 font-mono text-[11px] break-all text-(--t-text-muted) hover:text-(--t-text-primary) select-text"
          >
            {view.setup.secret}
            <Icon icon={keyCopied ? "lucide:check" : "lucide:copy"} width={11} className="shrink-0" />
          </button>
          {hint(t("settings.account.twoFactor.confirmPrompt"))}
        </>,
        "typed",
      );
      break;
    case "passkey":
      body = form(
        async (proof) =>
          settle(true, { kind: "passkeys" }, await passkey.track(() => addPasskey(password, proof, name))),
        t("settings.account.twoFactor.passkeyCreate"), leave,
        <>
          {hint(t("settings.account.twoFactor.passkeyIntro"))}
          {signsOutOthers}
          <SettingsInput placeholder={t("settings.account.twoFactor.passkeyName")} value={name} onChange={setName} />
          {passwordInput}
        </>,
        existingProof,
      );
      break;
    case "codes":
      body = <RecoveryCodes codes={view.codes} onDone={onClose} />;
      break;
    case "manage":
      body = (
        <div className="space-y-2">
          {hint(t("settings.account.twoFactor.manageBody"))}
          {error && <p className="text-xs text-(--t-status-error)">{error}</p>}
          {(held.totp || offered.totp) && (
            <ActionItem icon="lucide:smartphone" label={t("settings.account.twoFactor.authenticator")}
              sub={held.totp ? t("settings.account.twoFactor.authenticatorOn") : t("settings.account.twoFactor.authenticatorSub")}
              disabled={!factors}
              onClick={() => go(held.totp ? { kind: "remove", target: { kind: "totp" } } : { kind: "totp" })} />
          )}
          {(held.passkeys.length > 0 || offered.passkeys) && (
            <ActionItem icon="lucide:fingerprint" label={t("settings.account.twoFactor.passkeys")}
              sub={held.passkeys.map((one) => one.name).join(", ") || t("settings.account.twoFactor.passkeySub")}
              disabled={!factors}
              onClick={() => go({ kind: held.passkeys.length ? "passkeys" : "passkey" })} />
          )}
          <ActionItem icon="lucide:list-restart" label={t("settings.account.twoFactor.newCodes")}
            sub={held.recoveryCodesLeft === null
              ? t("settings.account.twoFactor.newCodesSub")
              : t("settings.account.twoFactor.codesLeft", { count: held.recoveryCodesLeft })}
            disabled={!factors}
            onClick={() => go({ kind: "regenerate" })} />
          <ActionItem icon="lucide:shield-off" danger label={t("settings.account.twoFactor.turnOff")}
            sub={t("settings.account.twoFactor.turnOffSub")}
            disabled={!factors}
            onClick={() => go({ kind: "remove", target: { kind: "all" } })} />
        </div>
      );
      break;
    case "passkeys":
      body = (
        <div className="space-y-2">
          <ul className="rounded-lg border border-(--t-border) divide-y divide-(--t-border)">
            {held.passkeys.map((one) => (
              <li key={one.id} className="flex items-center gap-3 px-3 py-2">
                <Icon icon="lucide:fingerprint" width={14} className="shrink-0 text-(--t-text-muted)" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-(--t-text-primary) truncate">{one.name}</p>
                  <p className="text-xs text-(--t-text-dim)">
                    {t("settings.account.twoFactor.passkeyAdded", { date: formatDate(one.created_at, SHORT_DATE) })}
                    {one.last_used_at &&
                      ` · ${t("settings.account.twoFactor.passkeyUsed", { date: formatDate(one.last_used_at, SHORT_DATE) })}`}
                  </p>
                </div>
                <button
                  type="button"
                  title={t("settings.account.twoFactor.passkeyRemove", { name: one.name })}
                  aria-label={t("settings.account.twoFactor.passkeyRemove", { name: one.name })}
                  onClick={() => go({ kind: "remove", target: { kind: "passkey", id: one.id, name: one.name } })}
                  className="p-1 rounded text-(--t-text-muted) hover:text-(--t-status-error)"
                >
                  <Icon icon="lucide:trash-2" width={14} />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={home} className="btn btn-secondary flex-1 py-1.5 rounded-lg text-sm">
              {t("settings.account.twoFactor.back")}
            </button>
            {offered.passkeys && (
              <button type="button" onClick={() => go({ kind: "passkey" })}
                className="btn btn-primary flex-1 py-1.5 rounded-lg text-sm font-medium">
                {t("settings.account.twoFactor.passkeyAdd")}
              </button>
            )}
          </div>
        </div>
      );
      break;
    case "regenerate":
      body = form(
        async (proof) => go({ kind: "codes", codes: await regenerateRecoveryCodes(proof) }),
        t("settings.account.twoFactor.generate"), home,
        hint(t("settings.account.twoFactor.regeneratePrompt")),
      );
      break;
    case "remove": {
      const { target } = view;
      const last =
        (target.kind === "totp" && held.passkeys.length === 0) ||
        (target.kind === "passkey" && !held.totp && held.passkeys.length === 1);
      body = form(
        async (proof) =>
          settle(await removeFactor(target, password, proof), { kind: target.kind === "passkey" ? "passkeys" : "manage" }),
        target.kind === "all" ? t("settings.account.twoFactor.turnOff") : t("settings.account.twoFactor.remove"),
        home,
        <>
          {hint(
            target.kind === "all"
              ? t("settings.account.twoFactor.disablePrompt")
              : target.kind === "totp"
                ? t("settings.account.twoFactor.removeAuthenticatorPrompt")
                : t("settings.account.twoFactor.removePasskeyPrompt", { name: target.name }),
          )}
          {last && <p className="text-xs text-(--t-status-warning) leading-relaxed">{t("settings.account.twoFactor.lastFactor")}</p>}
          {passwordInput}
        </>,
      );
      break;
    }
  }

  return (
    <SettingsDialog
      title={view.kind === "codes" ? t("settings.account.twoFactor.codesTitle") : t("settings.account.twoFactor.label")}
      // The codes are shown once: only the button that says they were saved closes this view.
      onClose={view.kind === "codes" ? () => {} : onClose}
    >
      {body}
    </SettingsDialog>
  );
}

/** Settings row and dialogs for the account's second factors. `enabled` is null until /me answers. */
export function TwoFactorSettings({ enabled, onChange }: {
  enabled: boolean | null;
  onChange: (enabled: boolean) => void;
}) {
  const { t } = useTranslation();
  const offered = useServerSecondFactors();
  const [open, setOpen] = useState(false);
  // An account already enrolled keeps the row on a server that stopped offering it: turning it off still works.
  if (enabled === null || (!enabled && !offered.totp && !offered.passkeys)) return null;
  return (
    <>
      <ActionItem
        icon={enabled ? "lucide:shield-check" : "lucide:shield"}
        label={t("settings.account.twoFactor.label")}
        sub={enabled ? t("settings.account.twoFactor.subOn") : t("settings.account.twoFactor.subOff")}
        onClick={() => setOpen(true)}
      />
      {open && <TwoFactorDialog enabled={enabled} offered={offered} onChange={onChange} onClose={() => setOpen(false)} />}
    </>
  );
}
