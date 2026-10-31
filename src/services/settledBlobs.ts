export interface BlobVersion {
  device_id: string;
  updated_at: string;
}

/** Remote blob versions already merged or found undecryptable, valid only while the merge inputs stay the same. */
function createSettledBlobs() {
  const settled = new Map<string, string>();
  let filter: string | null = null;
  // Weak, so a locked vault's keys are not kept alive here.
  let keys: Array<WeakRef<object> | null> = [];

  const sameKeys = (next: Array<object | null>) =>
    next.length === keys.length && next.every((k, i) => (keys[i]?.deref() ?? null) === k);

  return {
    /** Forgets every version when the filter or any key differs from the last call. */
    useInputs(nextFilter: string, nextKeys: Array<object | null>): void {
      if (nextFilter === filter && sameKeys(nextKeys)) return;
      settled.clear();
      filter = nextFilter;
      keys = nextKeys.map((k) => (k ? new WeakRef(k) : null));
    },
    has: (blob: BlobVersion) => settled.get(blob.device_id) === blob.updated_at,
    add: (blob: BlobVersion) => void settled.set(blob.device_id, blob.updated_at),
    clear: () => settled.clear(),
  };
}

export const settledBlobs = createSettledBlobs();

/** The next sync downloads and merges every remote blob again, announcing each through onRemotePayloadMerged. */
export function forgetMergedRemoteBlobs(): void {
  settledBlobs.clear();
}
