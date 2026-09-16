import { useEffect, useRef, useState } from "react";

export function useCopiedFlash(durationMs: number): { copied: boolean; flash: (persist?: boolean) => void } {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = (persist = false) => {
    setCopied(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (!persist) timeoutRef.current = setTimeout(() => setCopied(false), durationMs);
  };

  useEffect(() => () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); }, []);

  return { copied, flash };
}
