import { useCallback, useEffect, useState } from "react";
import { dockerCheckImageUpdate } from "./services";
import {
  getCachedStatus,
  getUpdateSettings,
  setCachedStatus,
  type DockerUpdateSettings,
} from "./runtime";
import type { ImageUpdateStatus } from "./types";

const CONCURRENCY = 4;

/** An image ref we can actually check against a registry. */
export function checkableImage(image: string | undefined | null): string | null {
  if (!image || image === "<none>" || image.includes("<none>")) return null;
  // skip raw image ids (no tag/repo) — nothing to resolve in a registry
  if (/^[0-9a-f]{12,64}$/.test(image)) return null;
  return image;
}

/**
 * Shared image-update tracking used by the Images, Containers, and Stacks views.
 * Results are cached per-host (see runtime), so checking the same image from
 * multiple views hits the registry only once within the TTL.
 */
export function useImageUpdates(opts: {
  images: string[];
  sessionId: string;
  isRemote: boolean;
  localShell: string | null;
}) {
  const { images, sessionId, isRemote, localShell } = opts;
  const [statuses, setStatuses] = useState<Record<string, ImageUpdateStatus>>({});
  const [checking, setChecking] = useState<Set<string>>(new Set());
  const [settings, setSettings] = useState<DockerUpdateSettings | null>(null);

  // Cache scope: per-host so local digests from different hosts don't collide.
  const scope = isRemote ? `ssh:${sessionId}` : `local:${localShell ?? "default"}`;

  useEffect(() => {
    getUpdateSettings().then(setSettings);
  }, []);

  const runChecks = useCallback(
    async (targets: string[], force: boolean) => {
      const uniq = [...new Set(targets.map(checkableImage).filter((t): t is string => !!t))];
      if (uniq.length === 0) return;
      const ttlMs = (settings?.intervalHours ?? 12) * 3_600_000;
      setChecking((prev) => new Set([...prev, ...uniq]));

      let idx = 0;
      const worker = async () => {
        while (idx < uniq.length) {
          const tag = uniq[idx++];
          try {
            let status = force ? null : await getCachedStatus(scope, tag, ttlMs);
            if (!status) {
              status = await dockerCheckImageUpdate(sessionId, isRemote, localShell, tag);
              await setCachedStatus(scope, tag, status);
            }
            setStatuses((prev) => ({ ...prev, [tag]: status! }));
          } catch {
            // leave unchecked on transient errors
          } finally {
            setChecking((prev) => {
              const next = new Set(prev);
              next.delete(tag);
              return next;
            });
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, uniq.length) }, worker));
    },
    [scope, sessionId, isRemote, localShell, settings?.intervalHours],
  );

  // Automatic sweep when enabled — only refs not already resolved or in flight.
  useEffect(() => {
    if (!settings?.autoCheck) return;
    const pending = images
      .map(checkableImage)
      .filter((t): t is string => !!t && !(t in statuses) && !checking.has(t));
    if (pending.length === 0) return;
    void runChecks(pending, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images, settings?.autoCheck]);

  const checkAll = useCallback(() => {
    void runChecks(images, true);
  }, [images, runChecks]);

  return { statuses, checking, settings, runChecks, checkAll };
}
