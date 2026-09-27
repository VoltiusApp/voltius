import { createPendingKeysByTeamStore } from "./pendingKeysByTeamStore";

/**
 * Keychain keys that a team offboarding wipe failed to delete.
 *
 * `clearTeamStoresAndSecrets` derives its key names from the team objects held
 * in the stores, then empties those stores — so once a removal has run, a key
 * whose delete failed can never be named again. Without this queue a failed
 * wipe leaves the team's plaintext passwords and private keys on the device
 * permanently, with nothing left to retry from (issues #216, #233).
 *
 * Only key names are persisted, never secret material.
 */
export const usePendingSecretWipeStore = createPendingKeysByTeamStore("voltius-pending-secret-wipe");
