import { useEffect, useRef, useState } from "react";

/**
 * Returns a version counter that bumps when the entity's updated_at changes
 * while the panel is open AND the user hasn't made any local edits yet.
 * Pass as part of a form's key prop to force a remount with fresh data on
 * remote sync without clobbering in-progress edits.
 */
export function useSyncedFormKey(
  entityUpdatedAt: string | undefined,
  isOpen: boolean,
  isDirty?: () => boolean,
): number {
  const [version, setVersion] = useState(0);
  const prevRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = entityUpdatedAt;
    if (!isOpen || entityUpdatedAt === undefined || prev === undefined || prev === entityUpdatedAt) return;
    // Never remount under the user's caret: a background bump of updated_at
    // (sync, ping, last-used) would otherwise steal focus from an input the
    // user just clicked but hasn't typed in yet.
    const el = document.activeElement;
    const typing =
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement ||
      (el instanceof HTMLElement && el.isContentEditable);
    if (!typing && !isDirty?.()) setVersion((v) => v + 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityUpdatedAt, isOpen]);

  return version;
}
