export interface TeamVaultRefreshOptions {
  background?: boolean;
}

export function shouldShowBlockingTeamVaultLoad(options: TeamVaultRefreshOptions = {}): boolean {
  return options.background !== true;
}

export class TeamVaultRefreshQueue {
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly followUps = new Map<string, Promise<void>>();

  run(teamId: string, refresh: () => Promise<void>): Promise<void> {
    const current = this.inFlight.get(teamId);
    if (!current) return this.start(teamId, refresh);

    const queued = this.followUps.get(teamId);
    if (queued) return queued;

    const followUp = current.catch(() => {}).then(() => {
      this.followUps.delete(teamId);
      return this.start(teamId, refresh);
    });
    this.followUps.set(teamId, followUp);
    return followUp;
  }

  private start(teamId: string, refresh: () => Promise<void>): Promise<void> {
    const next = refresh().finally(() => {
      if (this.inFlight.get(teamId) === next && !this.followUps.has(teamId)) {
        this.inFlight.delete(teamId);
      }
    });
    this.inFlight.set(teamId, next);
    return next;
  }
}
