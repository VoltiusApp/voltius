export interface TeamVaultRefreshOptions {
  background?: boolean;
}

export function shouldShowBlockingTeamVaultLoad(options: TeamVaultRefreshOptions = {}): boolean {
  return options.background !== true;
}

type Refresh<T> = (options: TeamVaultRefreshOptions) => Promise<T>;

interface FollowUp<T> {
  promise: Promise<T>;
  options: TeamVaultRefreshOptions;
}

export class TeamVaultRefreshQueue<T = void> {
  private readonly inFlight = new Map<string, Promise<T>>();
  private readonly followUps = new Map<string, FollowUp<T>>();

  run(teamId: string, options: TeamVaultRefreshOptions, refresh: Refresh<T>): Promise<T> {
    const current = this.inFlight.get(teamId);
    if (!current) return this.start(teamId, () => refresh(options));

    const queued = this.followUps.get(teamId);
    if (queued) {
      if (!options.background) queued.options.background = false;
      return queued.promise;
    }

    const followUp = { options: { ...options } } as FollowUp<T>;
    followUp.promise = current.catch(() => {}).then(() => {
      this.followUps.delete(teamId);
      return this.start(teamId, () => refresh(followUp.options));
    });
    this.followUps.set(teamId, followUp);
    return followUp.promise;
  }

  private start(teamId: string, refresh: () => Promise<T>): Promise<T> {
    const next = refresh().finally(() => {
      if (this.inFlight.get(teamId) === next && !this.followUps.has(teamId)) {
        this.inFlight.delete(teamId);
      }
    });
    this.inFlight.set(teamId, next);
    return next;
  }
}
