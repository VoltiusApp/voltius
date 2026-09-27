import { createPendingKeysByTeamStore } from "./pendingKeysByTeamStore";

/** Local secret keys a move into a team holds on disk until uploaded; retried on the team's next foreground load. */
export const usePendingTeamSecretUploadStore = createPendingKeysByTeamStore("voltius-pending-team-secret-upload");
