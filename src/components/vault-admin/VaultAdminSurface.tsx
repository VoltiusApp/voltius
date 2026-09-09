import { ContextMenu } from "@/components/shared/ContextMenu";
import { VaultAdminDialogs } from "./VaultAdminDialogs";
import type { useVaultAdmin } from "./useVaultAdmin";
import type { VaultAdminTarget } from "./vaultAdminTarget";

/**
 * The menu and the dialogs it opens, mounted as one thing.
 *
 * Every host that offers the vault menu needs both, always for the same target,
 * and the two were previously written out side by side in each host. Pairing
 * them here gives the trigger-independent behaviour one owner: the rail's
 * Members/Roles once acted on the active vault rather than the right-clicked
 * one precisely because no single place held the menu and its target together.
 */
export function VaultAdminSurface({
  admin, target, onClose,
}: {
  admin: ReturnType<typeof useVaultAdmin>;
  target: VaultAdminTarget | null;
  /** Extra teardown a host needs once a dialog closes, e.g. dropping its menu target. */
  onClose?: () => void;
}) {
  return (
    <>
      {admin.pos && <ContextMenu items={admin.items} pos={admin.pos} onClose={admin.closeMenu} />}
      {target && (
        <VaultAdminDialogs
          target={target}
          dialog={admin.dialog}
          onClose={() => { admin.setDialog(null); onClose?.(); }}
        />
      )}
    </>
  );
}
