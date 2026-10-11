import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import qrcode from "qrcode-generator";
import { INPUT_CLASS } from "@/components/layout/authParts";
import {
  EMPTY_TWO_FACTOR_ENTRY, TwoFactorField, entryProof, type TwoFactorEntry,
} from "@/components/shared/TwoFactorStep";
import { useCopiedFlash } from "@/hooks/useCopiedFlash";
import { saveTextFile } from "@/services/saveFile";
import { useServerOffersTwoFactor } from "@/services/serverCapabilities";
import {
  beginTwoFactorSetup, disableTwoFactor, enableTwoFactor, regenerateRecoveryCodes, type TwoFactorSetup,
} from "@/services/twoFactor";
import { writeClipboard } from "@/utils/clipboard";
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
  | { kind: "intro" }
  | { kind: "confirm"; setup: TwoFactorSetup }
  | { kind: "codes"; codes: string[] }
  | { kind: "manage" }
  | { kind: "regenerate" }
  | { kind: "disable" };

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

function TwoFactorDialog({ enabled, onChange, onClose }: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<View>({ kind: enabled ? "manage" : "intro" });
  const [password, setPassword] = useState("");
  const [entry, setEntry] = useState<TwoFactorEntry>(EMPTY_TWO_FACTOR_ENTRY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { copied: keyCopied, flash: flashKey } = useCopiedFlash(1500);

  const go = (next: View) => {
    setView(next);
    setEntry(EMPTY_TWO_FACTOR_ENTRY);
    setError("");
  };

  const attempt = (work: () => Promise<void>) => async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setEntry((current) => ({ ...current, value: "" }));
    } finally {
      setBusy(false);
    }
  };

  const withProof = (work: (proof: NonNullable<ReturnType<typeof entryProof>>) => Promise<void>) =>
    attempt(async () => {
      const proof = entryProof(entry);
      if (proof) await work(proof);
    });

  const form = (onSubmit: (e: FormEvent) => void, submitLabel: string, onCancel: () => void, children: ReactNode) => (
    <form onSubmit={onSubmit} className="space-y-2">
      {children}
      {error && <p className="text-xs text-(--t-status-error)">{error}</p>}
      <FormButtons onCancel={onCancel} submitting={busy} submitLabel={submitLabel} />
    </form>
  );

  const hint = (text: string) => <p className="text-xs text-(--t-text-dim) leading-relaxed">{text}</p>;
  const passwordInput = (
    <SettingsInput type="password" placeholder={t("layout.auth.masterPasswordPlaceholder")} value={password}
      onChange={setPassword} autoFocus />
  );

  let body: ReactNode;
  switch (view.kind) {
    case "intro":
      body = form(
        attempt(async () => go({ kind: "confirm", setup: await beginTwoFactorSetup(password) })),
        t("settings.account.twoFactor.continue"), onClose,
        <>
          {hint(t("settings.account.twoFactor.intro"))}
          {hint(t("settings.account.twoFactor.introDevices"))}
          {passwordInput}
        </>,
      );
      break;
    case "confirm":
      body = form(
        attempt(async () => {
          const codes = await enableTwoFactor(entry.value);
          onChange(true);
          go({ kind: "codes", codes });
        }),
        t("settings.account.twoFactor.turnOn"), onClose,
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
          <TwoFactorField entry={entry} onChange={setEntry} inputClassName={INPUT_CLASS} methods={["totp"]} autoFocus />
        </>,
      );
      break;
    case "codes":
      body = <RecoveryCodes codes={view.codes} onDone={onClose} />;
      break;
    case "manage":
      body = (
        <div className="space-y-2">
          {hint(t("settings.account.twoFactor.manageBody"))}
          <ActionItem icon="lucide:list-restart" label={t("settings.account.twoFactor.newCodes")}
            sub={t("settings.account.twoFactor.newCodesSub")} onClick={() => go({ kind: "regenerate" })} />
          <ActionItem icon="lucide:shield-off" danger label={t("settings.account.twoFactor.turnOff")}
            sub={t("settings.account.twoFactor.turnOffSub")} onClick={() => go({ kind: "disable" })} />
        </div>
      );
      break;
    case "regenerate":
      body = form(
        withProof(async (proof) => go({ kind: "codes", codes: await regenerateRecoveryCodes(proof) })),
        t("settings.account.twoFactor.generate"), () => go({ kind: "manage" }),
        <>
          {hint(t("settings.account.twoFactor.regeneratePrompt"))}
          <TwoFactorField entry={entry} onChange={setEntry} inputClassName={INPUT_CLASS} autoFocus />
        </>,
      );
      break;
    case "disable":
      body = form(
        withProof(async (proof) => {
          await disableTwoFactor(password, proof);
          onChange(false);
          onClose();
        }),
        t("settings.account.twoFactor.turnOff"), () => go({ kind: "manage" }),
        <>
          {hint(t("settings.account.twoFactor.disablePrompt"))}
          {passwordInput}
          <TwoFactorField entry={entry} onChange={setEntry} inputClassName={INPUT_CLASS} />
        </>,
      );
      break;
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

/** Settings row and dialogs for the account's second factor. `enabled` is null until /me answers. */
export function TwoFactorSettings({ enabled, onChange }: {
  enabled: boolean | null;
  onChange: (enabled: boolean) => void;
}) {
  const { t } = useTranslation();
  const offered = useServerOffersTwoFactor();
  const [open, setOpen] = useState(false);
  // An account already enrolled keeps the row on a server that stopped offering it: turning it off still works.
  if (enabled === null || (!enabled && !offered)) return null;
  return (
    <>
      <ActionItem
        icon={enabled ? "lucide:shield-check" : "lucide:shield"}
        label={t("settings.account.twoFactor.label")}
        sub={enabled ? t("settings.account.twoFactor.subOn") : t("settings.account.twoFactor.subOff")}
        onClick={() => setOpen(true)}
      />
      {open && <TwoFactorDialog enabled={enabled} onChange={onChange} onClose={() => setOpen(false)} />}
    </>
  );
}
