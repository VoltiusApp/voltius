import { useMemo, useEffect, useState } from "react";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useFolderStore } from "@/stores/folderStore";
import { useKeyStore } from "@/stores/keyStore";
import { useIdentityStore } from "@/stores/identityStore";
import { useSnippetStore } from "@/stores/snippetStore";
import { getSyncState, onSyncStateChange } from "@/services/sync";
import { deriveAccessibleVaultIds, deriveOrphanVaultIds, deriveScopedVaultId } from "@/hooks/accessibleVaults";

/** See `deriveOrphanVaultIds`. */
export function useOrphanVaultIds(): string[] {
  const vaults = useVaultStore((s) => s.vaults);
  const teams = useTeamStore((s) => s.teams);
  const connections = useConnectionStore((s) => s.connections);
  const folders = useFolderStore((s) => s.folders);
  const keys = useKeyStore((s) => s.keys);
  const identities = useIdentityStore((s) => s.identities);
  const snippets = useSnippetStore((s) => s.snippets);

  return useMemo(() => deriveOrphanVaultIds({
    objectVaultIds: [
      ...connections.map((o) => o.vault_id),
      ...folders.map((o) => o.vault_id),
      ...keys.map((o) => o.vault_id),
      ...identities.map((o) => o.vault_id),
      ...snippets.map((o) => o.vault_id),
    ],
    vaults,
    teams,
  }), [connections, folders, keys, identities, snippets, vaults, teams]);
}

/**
 * Returns the subset of selectedVaultIds that are currently accessible.
 * Personal vault and local (non-team) vaults are always accessible.
 * Team vaults require an active server connection — when offline they are excluded,
 * ensuring users always see the true server-enforced state (like Discord servers).
 *
 * Server UUIDs stored directly in selectedVaultIds (from standalone team toggles)
 * are also filtered out when that team is already linked to a local vault entry,
 * avoiding double-counting and stale IDs after a vault gets linked.
 */
export function useAccessibleVaultIds(): string[] {
  const selectedVaultIds = useVaultStore((s) => s.selectedVaultIds);
  const vaults = useVaultStore((s) => s.vaults);
  const teams = useTeamStore((s) => s.teams);
  const orphanVaultIds = useOrphanVaultIds();
  const [cloudActive, setCloudActive] = useState(() => getSyncState().cloudActive);

  useEffect(() => {
    return onSyncStateChange(() => setCloudActive(getSyncState().cloudActive));
  }, []);

  return useMemo(() => deriveAccessibleVaultIds({
    selectedVaultIds,
    vaults,
    teams,
    cloudActive,
    orphanVaultIds,
  }), [selectedVaultIds, vaults, teams, cloudActive, orphanVaultIds]);
}

/**
 * The vault the page root currently stands for, or null when several vaults are
 * on screen. See `deriveScopedVaultId`.
 */
export function useScopedVaultId(): string | null {
  const selectedVaultIds = useVaultStore((s) => s.selectedVaultIds);
  const vaults = useVaultStore((s) => s.vaults);
  const accessibleVaultIds = useAccessibleVaultIds();

  return useMemo(
    () => deriveScopedVaultId({ selectedVaultIds, vaults, accessibleVaultIds }),
    [selectedVaultIds, vaults, accessibleVaultIds],
  );
}
