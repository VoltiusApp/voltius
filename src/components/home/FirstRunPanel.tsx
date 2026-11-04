import { useEffect, useState, type FormEvent } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useUIStore } from "@/stores/uiStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useDefaultVaultId } from "@/hooks/useWritableVaultIds";
import { parseQuickConnect } from "@/services/quickConnect";
import { launchLocal, launchQuickConnect } from "@/services/launch";
import { isJoinInput } from "@/services/resolveJoinInput";
import { joinSessionByCode } from "@/services/teamSessionJoin";
import { countSshConfigHosts, importSshConfigHosts } from "@/services/sshConfig/onboarding";
import { log } from "@/lib/logger";

function useSshConfigHostCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let live = true;
    countSshConfigHosts().then((n) => { if (live) setCount(n); }).catch(() => {});
    return () => { live = false; };
  }, []);
  return count;
}

function ActionButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="btn btn-secondary flex items-center gap-2 h-9 px-3.5 rounded-xl text-sm">
      <Icon icon={icon} width={15} className="text-(--t-text-dim)" />
      {label}
    </button>
  );
}

function TextLink({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="focus-ring flex items-center gap-1.5 text-xs text-(--t-text-secondary) hover:text-(--t-accent) transition-colors">
      <Icon icon={icon} width={13} />
      {label}
    </button>
  );
}

export function FirstRunPanel() {
  const { t } = useTranslation();
  const [address, setAddress] = useState("");
  const [joinError, setJoinError] = useState("");
  const [joining, setJoining] = useState(false);
  const sshConfigCount = useSshConfigHostCount();
  const defaultVaultId = useDefaultVaultId();
  const openImportExport = useUIStore((s) => s.openImportExport);

  const trimmed = address.trim();
  const isJoin = isJoinInput(trimmed);
  const intent = isJoin ? null : parseQuickConnect(trimmed);
  const showHint = trimmed !== "" && !isJoin && !intent;

  const leaveHome = () => useUIStore.getState().setHomeView(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (intent) {
      leaveHome();
      launchQuickConnect(intent);
      return;
    }
    if (!isJoin || joining) return;
    setJoining(true);
    setJoinError("");
    try {
      await joinSessionByCode(trimmed);
      leaveHome();
    } catch (err) {
      log.error("first-run join failed", err);
      setJoinError(err instanceof Error ? err.message : t("hosts.teamSessions.failedToJoinSession"));
    } finally {
      setJoining(false);
    }
  };

  const newHost = () => {
    const ui = useUIStore.getState();
    useVaultStore.getState().selectVaultOnly(defaultVaultId);
    ui.setHomeView(false);
    ui.setActiveNav("hosts");
    ui.setHomePendingAction({ action: "create" });
  };

  const message = joinError || (showHint ? t("home.firstRun.addressHint") : "");

  return (
    <section aria-labelledby="first-run-title" className="mb-10">
      <h2 id="first-run-title" className="text-base font-semibold text-(--t-text-primary)">
        {t("home.firstRun.title")}
      </h2>
      <p className="text-sm mt-1 mb-4 text-(--t-text-secondary)">{t("home.firstRun.body")}</p>

      <form onSubmit={submit} className="flex gap-2">
        <div className="relative flex-1">
          <Icon icon="lucide:terminal" width={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-(--t-text-dim) pointer-events-none" />
          <input
            value={address}
            onChange={(e) => { setAddress(e.target.value); setJoinError(""); }}
            placeholder={t("home.firstRun.addressPlaceholder")}
            aria-label={t("home.firstRun.addressLabel")}
            aria-invalid={showHint || !!joinError || undefined}
            aria-describedby={message ? "first-run-message" : undefined}
            autoFocus
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="form-input w-full h-11 pl-10 pr-3 rounded-xl text-sm outline-hidden bg-(--t-bg-input) border border-(--t-border) text-(--t-text-primary)"
          />
        </div>
        <button
          type="submit"
          disabled={!intent && !isJoin}
          className="btn btn-primary flex items-center gap-2 h-11 px-5 rounded-xl text-sm font-medium"
        >
          {joining && <Icon icon="lucide:loader-circle" width={14} className="animate-spin" />}
          {isJoin ? t("home.firstRun.join") : t("common.action.connect")}
        </button>
      </form>
      <p
        id="first-run-message"
        role={joinError ? "alert" : undefined}
        className={`text-xs leading-4 mt-2 min-h-4 ${joinError ? "text-(--t-status-error)" : "text-(--t-text-secondary)"}`}
      >
        {message}
      </p>

      <div className="flex flex-wrap gap-2 mt-3">
        <ActionButton icon="lucide:plus" label={t("hosts.toolbar.newHost")} onClick={newHost} />
        {sshConfigCount > 0 && (
          <ActionButton
            icon="lucide:file-down"
            label={t("home.firstRun.importSshConfig", { count: sshConfigCount })}
            onClick={importSshConfigHosts}
          />
        )}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 mt-4">
        <TextLink icon="lucide:download" label={t("home.firstRun.importOther")} onClick={() => openImportExport("import")} />
        <TextLink icon="lucide:square-terminal" label={t("home.firstRun.localTerminal")} onClick={() => { leaveHome(); launchLocal(); }} />
      </div>
    </section>
  );
}
