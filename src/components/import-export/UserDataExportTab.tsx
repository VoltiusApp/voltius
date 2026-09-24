import { writeClipboard } from "../../utils/clipboard";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { USER_DATA_HANDLERS, buildUserDataBundle } from "@/services/user-data/registry";
import { toUserDataJSON } from "@/services/user-data/formats";
import { ActionBtn } from "./shared";
import { CheckboxBox } from "@/components/shared/Checkbox";
import { useCopiedFlash } from "@/hooks/useCopiedFlash";
import { saveTextFile } from "@/services/saveFile";

export function UserDataExportTab() {
  const { t } = useTranslation();
  const [included, setIncluded] = useState<Record<string, boolean>>(
    () => Object.fromEntries(USER_DATA_HANDLERS.map((h) => [h.key, true])),
  );
  const { copied, flash: flashCopied } = useCopiedFlash(2000);

  const selectedKeys = USER_DATA_HANDLERS.filter((h) => included[h.key]).map((h) => h.key);
  const bundle = buildUserDataBundle(selectedKeys);
  const payload = toUserDataJSON(bundle);

  const handleCopy = async () => {
    await writeClipboard(payload);
    flashCopied();
  };

  const handleDownload = () => void saveTextFile("voltius-settings.json", payload);

  return (
    <div className="flex flex-col gap-5 h-full">
      <div>
        <p className="text-xs font-bold uppercase tracking-widest mb-3 text-(--t-text-dim)">{t("importExport.include")}</p>
        <div className="flex flex-col gap-2.5">
          {USER_DATA_HANDLERS.map((h) => (
            <label key={h.key} className="flex items-center gap-2 cursor-pointer select-none">
              <CheckboxBox checked={!!included[h.key]} onClick={() => setIncluded((p) => ({ ...p, [h.key]: !p[h.key] }))} />
              <Icon icon={h.icon} width={13} className="text-(--t-text-muted) shrink-0" />
              <span className="text-sm text-(--t-text-primary)">{t(`importExport.userData.handlers.${h.key}.label`)}</span>
              <span className="text-xs text-(--t-text-dim) ml-auto">{h.describe()}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 pt-3 border-t border-(--t-border)">
        <ActionBtn icon={copied ? "lucide:check" : "lucide:clipboard-copy"} label={copied ? t("importExport.copied") : t("common.action.copy")} onClick={handleCopy} disabled={selectedKeys.length === 0} />
        <ActionBtn icon="lucide:download" label={t("importExport.downloadExt", { ext: "json" })} onClick={handleDownload} primary disabled={selectedKeys.length === 0} />
      </div>

      <div className="flex flex-col flex-1 min-h-0">
        <textarea readOnly value={payload}
          className="flex-1 w-full text-xs rounded-lg p-3 resize-none font-mono outline-hidden bg-(--t-bg-terminal) text-(--t-text-secondary) border border-(--t-border)"
        />
      </div>
    </div>
  );
}
