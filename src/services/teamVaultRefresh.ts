export interface TeamVaultRefreshOptions {
  background?: boolean;
}

export function shouldShowBlockingTeamVaultLoad(options: TeamVaultRefreshOptions = {}): boolean {
  return options.background !== true;
}

type Refresh = (options: TeamVaultRefreshOptions) => Promise<void>;

interface FollowUp {
  promise: Promise<void>;
  options: TeamVaultRefreshOptions;
}

export class TeamVaultRefreshQueue {
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly followUps = new Map<string, FollowUp>();

  run(teamId: string, options: TeamVaultRefreshOptions, refresh: Refresh): Promise<void> {
    const current = this.inFlight.get(teamId);
    if (!current) return this.start(teamId, () => refresh(options));

    const queued = this.followUps.get(teamId);
    if (queued) {
      if (!options.background) queued.options.background = false;
      return queued.promise;
    }

    const followUp: FollowUp = { options: { ...options }, promise: Promise.resolve() };
    followUp.promise = current.catch(() => {}).then(() => {
      this.followUps.delete(teamId);
      return this.start(teamId, () => refresh(followUp.options));
    });
    this.followUps.set(teamId, followUp);
    return followUp.promise;
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
