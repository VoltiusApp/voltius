import { useState, type FormEvent } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useUIStore } from "@/stores/uiStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useDefaultVaultId } from "@/hooks/useWritableVaultIds";
import { parseQuickConnect } from "@/services/quickConnect";
import { launchQuickConnect } from "@/services/launch";
import { isJoinInput } from "@/services/resolveJoinInput";
import { joinSessionByCode } from "@/services/teamSessionJoin";
import { log } from "@/lib/logger";

const leaveHome = () => useUIStore.getState().setHomeView(false);

export function useNewHost(): () => void {
  const defaultVaultId = useDefaultVaultId();
  return () => {
    const ui = useUIStore.getState();
    useVaultStore.getState().selectVaultOnly(defaultVaultId);
    ui.setHomeView(false);
    ui.setActiveNav("hosts");
    ui.setHomePendingAction({ action: "create" });
  };
}

interface Props {
  placeholder: string;
  autoFocus?: boolean;
  /** Text that is neither user@host nor an invite code opens Ctrl+K search instead of showing the format hint. */
  searchFallback?: boolean;
}

export function ConnectPrompt({ placeholder, autoFocus, searchFallback }: Props) {
  const { t } = useTranslation();
  const [address, setAddress] = useState("");
  const [joinError, setJoinError] = useState("");
  const [joining, setJoining] = useState(false);

  const trimmed = address.trim();
  const isJoin = isJoinInput(trimmed);
  const intent = isJoin ? null : parseQuickConnect(trimmed);
  const isSearch = !!searchFallback && trimmed !== "" && !isJoin && !intent;
  const showHint = !searchFallback && trimmed !== "" && !isJoin && !intent;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (intent) {
      leaveHome();
      launchQuickConnect(intent);
      return;
    }
    if (isSearch) {
      useUIStore.getState().openOmniWith(trimmed);
      setAddress("");
      return;
    }
    if (!isJoin || joining) return;
    setJoining(true);
    setJoinError("");
    try {
      await joinSessionByCode(trimmed);
      leaveHome();
    } catch (err) {
      log.error("connect prompt join failed", err);
      setJoinError(err instanceof Error ? err.message : t("hosts.teamSessions.failedToJoinSession"));
    } finally {
      setJoining(false);
    }
  };

  const message = joinError || (showHint ? t("home.firstRun.addressHint") : "");
  const label = isJoin ? t("home.firstRun.join") : isSearch ? t("home.connect.search") : t("common.action.connect");

  return (
    <>
      <form onSubmit={submit} className="flex gap-2">
        <div className="relative flex-1">
          <Icon icon="lucide:terminal" width={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-(--t-text-dim) pointer-events-none" />
          <input
            value={address}
            onChange={(e) => { setAddress(e.target.value); setJoinError(""); }}
            placeholder={placeholder}
            aria-label={t("home.firstRun.addressLabel")}
            aria-invalid={showHint || !!joinError || undefined}
            aria-describedby={message ? "connect-prompt-message" : undefined}
            autoFocus={autoFocus}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="form-input w-full h-11 pl-10 pr-3 rounded-xl text-sm font-mono outline-hidden bg-(--t-bg-input) border border-(--t-border) text-(--t-text-primary)"
          />
        </div>
        <button
          type="submit"
          disabled={!intent && !isJoin && !isSearch}
          className="btn btn-primary flex items-center justify-center gap-2 h-11 min-w-28 px-5 rounded-xl text-sm font-medium"
        >
          {joining && <Icon icon="lucide:loader-circle" width={14} className="animate-spin" />}
          {label}
        </button>
      </form>
      <p
        id="connect-prompt-message"
        role={joinError ? "alert" : undefined}
        className={`text-xs leading-4 mt-2 min-h-4 ${joinError ? "text-(--t-status-error)" : "text-(--t-text-secondary)"}`}
      >
        {message}
      </p>
    </>
  );
}
