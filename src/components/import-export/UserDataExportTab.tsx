import { writeClipboard } from "../../utils/clipboard";
import { useState } from "react";
import { Icon } from "@iconify/react";
import { USER_DATA_HANDLERS, buildUserDataBundle } from "@/services/user-data/registry";
import { toUserDataJSON } from "@/services/user-data/formats";
import { ActionBtn } from "./shared";

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export function UserDataExportTab() {
  const [included, setIncluded] = useState<Record<string, boolean>>(
    () => Object.fromEntries(USER_DATA_HANDLERS.map((h) => [h.key, true])),
  );
  const [copied, setCopied] = useState(false);

  const selectedKeys = USER_DATA_HANDLERS.filter((h) => included[h.key]).map((h) => h.key);
  const bundle = buildUserDataBundle(selectedKeys);
  const payload = toUserDataJSON(bundle);

  const handleCopy = async () => {
    await writeClipboard(payload);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => downloadJson("voltius-settings.json", JSON.parse(payload));

  return (
    <div className="flex flex-col gap-5 h-full">
      <div>
        <p className="text-xs font-bold uppercase tracking-widest mb-3 text-[var(--t-text-dim)]">Include</p>
        <div className="flex flex-col gap-2.5">
          {USER_DATA_HANDLERS.map((h) => (
            <label key={h.key} className="flex items-center gap-2 cursor-pointer select-none">
              <span
                onClick={() => setIncluded((p) => ({ ...p, [h.key]: !p[h.key] }))}
                className="flex items-center justify-center w-4 h-4 rounded transition-colors shrink-0"
                style={{
                  background: included[h.key] ? "var(--t-accent)" : "var(--t-bg-input)",
                  border: `1px solid ${included[h.key] ? "var(--t-accent)" : "var(--t-border-hover)"}`,
                }}
              >
                {included[h.key] && <Icon icon="lucide:check" width={10} color="white" />}
              </span>
              <Icon icon={h.icon} width={13} className="text-[var(--t-text-muted)] shrink-0" />
              <span className="text-sm text-[var(--t-text-primary)]">{h.label}</span>
              <span className="text-xs text-[var(--t-text-dim)] ml-auto">{h.describe()}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 pt-3 border-t border-[var(--t-border)]">
        <ActionBtn icon={copied ? "lucide:check" : "lucide:clipboard-copy"} label={copied ? "Copied!" : "Copy"} onClick={handleCopy} disabled={selectedKeys.length === 0} />
        <ActionBtn icon="lucide:download" label="Download .json" onClick={handleDownload} primary disabled={selectedKeys.length === 0} />
      </div>

      <div className="flex flex-col flex-1 min-h-0">
        <textarea readOnly value={payload}
          className="flex-1 w-full text-xs rounded-lg p-3 resize-none font-mono outline-none bg-[var(--t-bg-terminal)] text-[var(--t-text-secondary)] border border-[var(--t-border)]"
        />
      </div>
    </div>
  );
}
