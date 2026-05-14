export interface TeamVaultRefreshOptions {
  background?: boolean;
}

export function shouldShowBlockingTeamVaultLoad(options: TeamVaultRefreshOptions = {}): boolean {
  return options.background !== true;
}

export class TeamVaultRefreshQueue {
  private readonly inFlight = new Map<string, Promise<void>>();

  run(teamId: string, refresh: () => Promise<void>): Promise<void> {
    const current = this.inFlight.get(teamId);
    if (current) return current;

    const next = refresh().finally(() => {
      if (this.inFlight.get(teamId) === next) {
        this.inFlight.delete(teamId);
      }
    });
    this.inFlight.set(teamId, next);
    return next;
  }
}
