import { useState, useCallback } from "react";

export type CascadeItem = { type: "identity" | "key" | "connection"; label: string };

export type PendingCascade = {
  operation: "move" | "copy";
  targetVaultName: string;
  items: CascadeItem[];
  /** Override the default "linked items in a different vault" description */
  description?: string;
  execute: () => Promise<void>;
};

export function useVaultCascade() {
  const [pending, setPending] = useState<PendingCascade | null>(null);

  const request = useCallback((cascade: PendingCascade) => {
    if (cascade.items.length === 0) {
      void cascade.execute();
    } else {
      setPending(cascade);
    }
  }, []);

  const confirm = useCallback(async () => {
    if (!pending) return;
    await pending.execute();
    setPending(null);
  }, [pending]);

  const cancel = useCallback(() => setPending(null), []);

  return { pending, request, confirm, cancel };
}
