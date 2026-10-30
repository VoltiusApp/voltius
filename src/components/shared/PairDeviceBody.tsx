import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { cancelPairing, closePairing, confirmPairing, openPairing } from "@/services/lanSync";
import { useLanSyncStore } from "@/stores/lanSyncStore";

const ENDED_REASONS = new Set([
  "accountDevice", "bothGrouped", "alreadyPaired", "timedOut", "cancelled", "busy", "tooManyAttempts", "failed", "stopped",
]);

const formatCode = (sas: number) => {
  const digits = String(sas).padStart(6, "0");
  return `${digits.slice(0, 3)} ${digits.slice(3)}`;
};

function PairButton({ slug, primary, autoFocus, onClick, children }: {
  slug: string;
  primary?: boolean;
  autoFocus?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      data-pair-action={slug}
      autoFocus={autoFocus}
      onClick={onClick}
      className={`btn ${primary ? "btn-primary" : "btn-secondary"} min-h-11 px-4 py-2 rounded-lg text-sm font-medium`}
    >
      {children}
    </button>
  );
}

export function PairDeviceBody({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { state, sas, peerName = "", peerHasData, reason, closed, granted, replaces } = useLanSyncStore((s) => s.pairing);

  useEffect(() => {
    void openPairing();
    return () => void closePairing();
  }, []);

  const local = (key: string, o?: Record<string, unknown>) => t(`layout.sync.local.pair.${key}`, o);
  const windowOpen = state === "idle" || state === "searching" || (state === "ended" && !closed);
  const hasCode = state === "code" || state === "peerConfirmed";
  const ended = state === "ended" ? (ENDED_REASONS.has(reason ?? "") ? reason : "failed") : null;

  return (
    <div data-pair-body className="flex flex-col gap-4 text-sm text-(--t-text-secondary)">
      {ended && (
        <p data-pair-reason role="alert" className="text-(--t-status-warning)">
          {t(`errors.pair.ended.${ended}`)}
        </p>
      )}

      {windowOpen && (
        <>
          <div className="flex items-start gap-2">
            <Icon icon="lucide:radar" width={16} className="shrink-0 mt-0.5 motion-safe:animate-pulse" />
            <p>{local("searching")}</p>
          </div>
          <p className="text-xs text-(--t-text-dim)">{local("signedInHint")}</p>
          <div className="flex justify-end">
            <PairButton slug="close" onClick={onClose}>{local("close")}</PairButton>
          </div>
        </>
      )}

      {hasCode && (
        <>
          <p>{local("compare")}</p>
          <div
            data-pair-code
            className="text-center text-4xl font-semibold tabular-nums tracking-widest text-(--t-text-primary)"
          >
            {formatCode(sas ?? 0)}
          </div>
          {replaces && (
            <p data-pair-replaces role="alert" className="text-center text-(--t-status-warning)">
              {local("replaces", { name: replaces })}
            </p>
          )}
          {state === "peerConfirmed" && <p className="text-center text-(--t-status-connected)">{local("peerConfirmed", { name: peerName })}</p>}
          {peerHasData && <p className="text-xs text-(--t-text-dim)">{local("hasData", { name: peerName })}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <PairButton slug="cancel" onClick={() => void cancelPairing()}>{local("cancel")}</PairButton>
            {peerHasData ? (
              <>
                <PairButton slug="theirs" onClick={() => void confirmPairing("replace")}>{local("useTheirs", { name: peerName })}</PairButton>
                <PairButton slug="combine" primary autoFocus onClick={() => void confirmPairing("combine")}>{local("combine")}</PairButton>
              </>
            ) : (
              <PairButton slug="confirm" primary autoFocus onClick={() => void confirmPairing()}>{local("confirm")}</PairButton>
            )}
          </div>
        </>
      )}

      {state === "joining" && (
        <>
          <div className="flex items-center gap-2">
            <Icon icon="lucide:loader-circle" width={16} className="motion-safe:animate-spin" />
            <p>{local("joining")}</p>
          </div>
          {!granted && (
            <div className="flex justify-end">
              <PairButton slug="cancel" onClick={() => void cancelPairing()}>{local("cancel")}</PairButton>
            </div>
          )}
        </>
      )}

      {state === "done" && (
        <>
          <div className="flex items-center gap-2 text-(--t-status-connected)">
            <Icon icon="lucide:circle-check" width={18} />
            <p>{local("done", { name: peerName })}</p>
          </div>
          <div className="flex justify-end">
            <PairButton slug="close" primary autoFocus onClick={onClose}>{local("close")}</PairButton>
          </div>
        </>
      )}

      {state === "ended" && closed && (
        <div className="flex justify-end gap-2">
          <PairButton slug="close" onClick={onClose}>{local("close")}</PairButton>
          <PairButton slug="retry" primary autoFocus onClick={() => void openPairing()}>{local("tryAgain")}</PairButton>
        </div>
      )}
    </div>
  );
}
