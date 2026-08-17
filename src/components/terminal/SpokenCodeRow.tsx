import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { mintSessionCode } from "@/services/multiplayerService";
import { formatShortCode } from "@/services/shortCode";
import { InviteCodeField } from "./InviteCodeField";

function mmss(secondsLeft: number): string {
  const m = Math.floor(secondsLeft / 60);
  const s = secondsLeft % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * The read-aloud half of an invite: a short code the server kills after ten
 * minutes. Minted on demand rather than alongside the link, so its window starts
 * when the host actually needs to say it.
 */
export function SpokenCodeRow({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (expiresAt === null) return;
    const tick = () => {
      const left = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) {
        setCode(null);
        setExpiresAt(null);
        setExpired(true);
      }
    };
    tick();
    intervalRef.current = setInterval(tick, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [expiresAt]);

  const handleMint = async () => {
    setLoading(true);
    setError(null);
    setExpired(false);
    try {
      const minted = await mintSessionCode(sessionId);
      setCode(formatShortCode(minted.code));
      setExpiresAt(new Date(minted.expiresAt).getTime());
    } catch (err) {
      setError(err instanceof Error ? err.message : t("terminal.share.failedToMintCode"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      {code ? (
        <>
          <InviteCodeField code={code} />
          <div className="flex items-center gap-2 text-[10px]" style={{ color: "var(--t-text-dim)" }}>
            <span>
              {t("terminal.share.readAloudHint")}
              {" · "}
              <span className="tabular-nums" style={{ color: "var(--t-status-warning)" }}>
                {t("terminal.share.expiresIn", { time: mmss(remaining) })}
              </span>
            </span>
            <button
              className="ml-auto transition-opacity"
              style={{ color: "var(--t-accent)", opacity: loading ? 0.5 : 1 }}
              disabled={loading}
              onClick={handleMint}
            >
              {t("terminal.share.newCode")}
            </button>
          </div>
        </>
      ) : (
        <>
          <button
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-opacity"
            style={{
              background: "var(--t-bg-elevated)",
              border: "1px solid var(--t-border)",
              color: "var(--t-text-secondary)",
              opacity: loading ? 0.5 : 1,
            }}
            disabled={loading}
            onClick={handleMint}
          >
            <Icon icon="lucide:megaphone" width={12} />
            {expired ? t("terminal.share.codeExpired") : t("terminal.share.getSpokenCode")}
          </button>
          {error && (
            <p className="text-[10px]" style={{ color: "var(--t-status-error)" }}>{error}</p>
          )}
        </>
      )}
    </div>
  );
}
