import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useHostPicker } from "@/hooks/useHostPicker";
import { ChipInput } from "@/components/shared/ChipInput";
import { ConnectionHostRow } from "@/components/shared/HostPickerPanel";
import { HostPickerTree } from "@/components/shared/HostPickerTree";
import { connectionDisplayName } from "@/utils/connectionDisplayName";
import { useIsMobile } from "@/utils/platform";
import type { Connection } from "@/types";

export function RuleHosts({ vaultId, hosts, selected, onToggle }: {
  vaultId: string;
  hosts: Connection[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const { t } = useTranslation();
  const touch = useIsMobile();
  const [query, setQuery] = useState("");
  const { rows, recent, toggleFolder, hasHosts } = useHostPicker({ query, sshOnly: true, vaultId });
  const label = (id: string) => {
    const c = hosts.find((h) => h.id === id);
    return c ? connectionDisplayName(c) : id;
  };

  const addFirstMatch = () => {
    const match = rows.find((r) => r.kind === "host" && !selected.includes(r.connection.id));
    if (match?.kind === "host") onToggle(match.connection.id);
    setQuery("");
  };

  return (
    <div className="mt-2 space-y-1.5">
      <ChipInput
        value={selected}
        input={query}
        onInputChange={setQuery}
        onAdd={addFirstMatch}
        onRemove={onToggle}
        removeOnBackspace={false}
        keepPlaceholder
        itemLabel={(id) => <span className="truncate max-w-40">{label(id)}</span>}
        renderChip={(id, children) => (
          <span key={id} data-rule-host-chip={id} className="flex items-center gap-1 min-w-0 px-2 py-0.5 rounded-md text-xs font-medium bg-(--t-bg-elevated) text-(--t-text-primary)">
            {children}
          </span>
        )}
        removeLabel={(id) => t("portForwarding.ruleForm.removeHost", { name: label(id) })}
        placeholder={t("shared.hostPicker.filterPlaceholder")}
        ariaLabel={t("shared.hostPicker.filterPlaceholder")}
        emptyIcon="lucide:filter"
      />
      <div className="max-h-64 overflow-y-auto">
        {!hasHosts ? (
          <p className="text-xs text-(--t-text-dim) py-1">{t("portForwarding.ruleForm.noSavedConnections")}</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-(--t-text-dim) py-1">{t("shared.hostPicker.noHostsMatch")}</p>
        ) : (
          <HostPickerTree
            rows={rows}
            recent={recent}
            onToggleFolder={toggleFolder}
            density={touch ? "touch" : "compact"}
            renderHost={(c) => <ConnectionHostRow connection={c} isSelected={selected.includes(c.id)} onClick={() => onToggle(c.id)} multiSelect />}
          />
        )}
      </div>
    </div>
  );
}
