import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useUIStore } from "@/stores/uiStore";
import { launchLocal } from "@/services/launch";
import { countSshConfigHosts, importSshConfigHosts } from "@/services/sshConfig/onboarding";
import { ConnectPrompt, useNewHost } from "./ConnectPrompt";

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

export function TextLink({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="focus-ring flex items-center gap-1.5 text-xs text-(--t-text-secondary) hover:text-(--t-accent) transition-colors">
      <Icon icon={icon} width={13} />
      {label}
    </button>
  );
}

export function FirstRunPanel() {
  const { t } = useTranslation();
  const sshConfigCount = useSshConfigHostCount();
  const openImportExport = useUIStore((s) => s.openImportExport);
  const newHost = useNewHost();

  return (
    <section aria-labelledby="first-run-title" className="mb-10">
      <h2 id="first-run-title" className="text-base font-semibold text-(--t-text-primary)">
        {t("home.firstRun.title")}
      </h2>
      <p className="text-sm mt-1 mb-4 text-(--t-text-secondary)">{t("home.firstRun.body")}</p>

      <ConnectPrompt placeholder={t("home.firstRun.addressPlaceholder")} autoFocus />

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
        <TextLink icon="lucide:square-terminal" label={t("home.firstRun.localTerminal")} onClick={() => { useUIStore.getState().setHomeView(false); launchLocal(); }} />
      </div>
    </section>
  );
}
