import { useIdentityStore } from "@/stores/identityStore";
import { findIdentityIn, isOwnIdentityIn, type IdentityCollections } from "@/services/credentialScope";

function loadedIdentities(): IdentityCollections {
  const { identities, teamIdentities } = useIdentityStore.getState();
  return { ownIdentities: identities, teamIdentities };
}

export const findLoadedIdentity = (id: string) => findIdentityIn(loadedIdentities(), id);
export const isOwnLoadedIdentity = (id: string) => isOwnIdentityIn(loadedIdentities(), id);
