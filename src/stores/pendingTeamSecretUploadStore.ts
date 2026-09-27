import { createPendingKeysByTeamStore } from "./pendingKeysByTeamStore";

/** Local secret keys a personal→team move wrote to disk but could not upload; retried on the team's next foreground load. */
export const usePendingTeamSecretUploadStore = createPendingKeysByTeamStore("voltius-pending-team-secret-upload");
