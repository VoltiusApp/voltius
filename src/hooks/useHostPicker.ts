import { useCallback, useMemo, useState } from "react";
import { useAllConnections } from "@/hooks/useAllConnections";
import { useAllFolders } from "@/hooks/useAllFolders";
import { useVaultOptions } from "@/hooks/useVaultOptions";
import { matchesSearch, compareConnections } from "@/utils/connectionFilter";
import { hostPickerRows, uniqueVaults, vaultIdOf } from "@/utils/hostPickerTree";
import type { SortMode } from "@/components/shared/ToolbarViewControls";

const NONE: ReadonlySet<string> = new Set();

export function useHostPicker({ query, sortMode, sshOnly, vaultId, excludeId }: {
  query: string;
  sortMode?: SortMode;
  sshOnly?: boolean;
  vaultId?: string;
  excludeId?: string;
}) {
  const connections = useAllConnections();
  const folders = useAllFolders();
  const vaultOptions = useVaultOptions();
  const [vaultFilter, setVaultFilter] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(NONE);

  const eligible = useMemo(
    () => connections.filter((c) =>
      (!vaultId || vaultIdOf(c) === vaultId)
      && (!sshOnly || (c.connection_type !== "serial" && !c.serial_port))
      && c.id !== excludeId),
    [connections, vaultId, sshOnly, excludeId],
  );

  const vaults = useMemo(
    () => uniqueVaults(vaultOptions).filter((v) => eligible.some((c) => vaultIdOf(c) === v.id)),
    [vaultOptions, eligible],
  );
  const activeVault = vaultFilter && vaults.some((v) => v.id === vaultFilter) ? vaultFilter : null;
  const searching = query.trim() !== "";

  const rows = useMemo(() => {
    const matched = eligible.filter((c) => (!activeVault || vaultIdOf(c) === activeVault) && matchesSearch(c, query));
    if (sortMode) matched.sort((a, b) => compareConnections(a, b, sortMode));
    return hostPickerRows(matched, folders, vaultOptions, searching ? NONE : collapsed);
  }, [eligible, activeVault, query, sortMode, folders, vaultOptions, searching, collapsed]);

  const toggleFolder = useCallback((id: string) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (!next.delete(id)) next.add(id);
    return next;
  }), []);

  return {
    rows,
    vaults,
    vaultFilter: activeVault,
    setVaultFilter,
    toggleFolder,
    hasHosts: eligible.length > 0,
  };
}
