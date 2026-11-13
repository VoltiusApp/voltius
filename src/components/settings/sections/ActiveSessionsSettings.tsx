import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AvatarTile } from "@/components/shared/AvatarTile";
import { ConfirmModal } from "@/components/shared/ConfirmModal";
import {
  listSessions, revokeAllSessions, revokeOtherSessions, revokeSession, type SignedInSession,
} from "@/services/authSessions";
import { DEVICE_TILE_BASE, deviceIcon } from "@/utils/icons";
import { formatDate, formatRelative, SHORT_DATE } from "@/utils/localeFormat";
import { platformName } from "@/utils/platform";
import { SettingRow, SettingsGroup } from "./shared";

type Listing =
  | { kind: "loading" }
  | { kind: "ready"; sessions: SignedInSession[] }
  | { kind: "unsupported" }
  | { kind: "failed"; message: string }
  | { kind: "ended" };

type Pending = { kind: "one"; session: SignedInSession } | { kind: "others" } | { kind: "all" };

const BUTTON_SHAPE = "shrink-0 h-8 px-3 rounded-lg text-xs font-medium disabled:cursor-not-allowed";
const BUTTON = `btn btn-secondary ${BUTTON_SHAPE}`;
const DANGER_BUTTON = `btn btn-danger ${BUTTON_SHAPE}`;
const BADGE = "shrink-0 px-1.5 py-px rounded text-[10px] font-medium";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

/** Account rows listing the devices signed in to this cloud account, with sign-out for one, the others, or all. */
export function ActiveSessionsSettings() {
  const { t } = useTranslation();
  const online = useOnline();
  const [listing, setListing] = useState<Listing>({ kind: "loading" });
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setListing({ kind: "loading" });
    try {
      const sessions = await listSessions();
      setListing(sessions ? { kind: "ready", sessions } : { kind: "unsupported" });
    } catch (e) {
      setListing({ kind: "failed", message: message(e) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const blocked =
    !online ? t("settings.account.sessions.offline")
    : listing.kind === "unsupported" ? t("settings.account.sessions.unsupported")
    : listing.kind === "ended" ? t("settings.account.sessions.ended")
    : listing.kind !== "ready" ? t("settings.account.sessions.unavailable")
    : null;

  const endsHere = (p: Pending) => p.kind === "all" || (p.kind === "one" && p.session.current);

  const confirm = async (p: Pending) => {
    setBusy(true);
    setError("");
    try {
      if (p.kind === "one") await revokeSession(p.session);
      else if (p.kind === "others") await revokeOtherSessions();
      else await revokeAllSessions();
      setPending(null);
      if (endsHere(p)) setListing({ kind: "ended" });
      else await load();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const nameOf = (s: SignedInSession) => s.device_name || t("settings.account.sessions.unknownDevice");

  const confirmText = (p: Pending): { title: string; message: string } => {
    if (p.kind === "others" || p.kind === "all") {
      return { title: t(`settings.account.sessions.confirm.${p.kind}.title`), message: t(`settings.account.sessions.confirm.${p.kind}.message`) };
    }
    if (p.session.current) {
      return { title: t("settings.account.sessions.confirm.this.title"), message: t("settings.account.sessions.confirm.this.message") };
    }
    const name = nameOf(p.session);
    return { title: t("settings.account.sessions.confirm.one.title", { name }), message: t("settings.account.sessions.confirm.one.message", { name }) };
  };

  const status = (text: string, tone = "text-(--t-text-dim)") => <div className={`px-4 py-3 text-xs ${tone}`}>{text}</div>;

  const row = (s: SignedInSession) => {
    const name = nameOf(s);
    const details = [
      s.platform && platformName(s.platform),
      t("settings.account.sessions.signedIn", { date: formatDate(s.created_at, SHORT_DATE) }),
      t("settings.account.sessions.lastActive", { ago: formatRelative(s.last_seen_at, { maxDays: 30 }) }),
    ].filter(Boolean);
    return (
      <SettingRow
        key={s.id}
        title={
          <span className="flex items-center gap-2.5 min-w-0">
            <AvatarTile base={DEVICE_TILE_BASE} icon={deviceIcon(s.platform ?? "")} iconSize={14}
              className="w-7 h-7 rounded-lg text-(--t-text-bright)" />
            <span className="truncate">{name}</span>
            {s.client === "cli" && (
              <span className={`${BADGE} bg-(--t-bg-input) text-(--t-text-muted)`}>{t("settings.account.sessions.cli")}</span>
            )}
            {s.current && (
              <span className={`${BADGE} bg-(--t-accent) text-(--t-on-accent)`}>{t("settings.account.sessions.thisDevice")}</span>
            )}
          </span>
        }
        desc={details.join(" · ")}
      >
        <button type="button" className={BUTTON} disabled={!!blocked} title={blocked ?? undefined}
          aria-label={t("settings.account.sessions.signOutNamed", { name })}
          onClick={() => setPending({ kind: "one", session: s })}>
          {t("settings.account.sessions.signOut")}
        </button>
      </SettingRow>
    );
  };

  let body;
  switch (listing.kind) {
    case "loading":
      body = status(t("settings.account.sessions.loading"));
      break;
    case "unsupported":
      body = status(t("settings.account.sessions.unsupported"));
      break;
    case "ended":
      body = status(t("settings.account.sessions.ended"));
      break;
    case "failed":
      body = (
        <div className="px-4 py-3 flex items-center justify-between gap-4">
          <span className="text-xs text-(--t-status-error)">{listing.message}</span>
          <button type="button" className={BUTTON} onClick={() => void load()}>{t("settings.account.sessions.retry")}</button>
        </div>
      );
      break;
    case "ready":
      body = listing.sessions.length ? listing.sessions.map(row) : status(t("settings.account.sessions.empty"));
      break;
  }

  const shown = pending ? confirmText(pending) : null;

  return (
    <SettingsGroup title={t("settings.account.sessions.title")} divided>
      {body}
      <div className="px-4 py-3 space-y-3">
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BUTTON} disabled={!!blocked} title={blocked ?? undefined}
            onClick={() => setPending({ kind: "others" })}>
            {t("settings.account.sessions.signOutOthers")}
          </button>
          <button type="button" className={DANGER_BUTTON} disabled={!!blocked}
            title={blocked ?? undefined} onClick={() => setPending({ kind: "all" })}>
            {t("settings.account.sessions.signOutEverywhere")}
          </button>
        </div>
        <p className="text-xs text-(--t-text-dim) leading-relaxed">{t("settings.account.sessions.note")}</p>
      </div>
      {pending && shown && (
        <ConfirmModal
          title={shown.title}
          message={shown.message}
          tone={pending.kind === "others" ? "warning" : "danger"}
          icon="lucide:log-out"
          confirmLabel={t("settings.account.sessions.signOut")}
          busy={busy}
          busyLabel={t("settings.account.sessions.working")}
          onConfirm={() => void confirm(pending)}
          onCancel={() => {
            setPending(null);
            setError("");
          }}
        >
          {error && <p className="text-xs text-(--t-status-error)">{error}</p>}
        </ConfirmModal>
      )}
    </SettingsGroup>
  );
}
