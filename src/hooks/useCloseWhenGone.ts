import { useEffect, useRef } from "react";

/**
 * Closes an editor once the object it was showing leaves the list, e.g. when
 * access to it is revoked. An id not yet seen in the list (a create in flight) is left alone.
 */
export function useCloseWhenGone(id: string | null | undefined, present: boolean, close: () => void) {
  const shownId = useRef<string | null>(null);
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!id) { shownId.current = null; return; }
    if (present) { shownId.current = id; return; }
    if (shownId.current !== id) return;
    shownId.current = null;
    closeRef.current();
  }, [id, present]);
}
