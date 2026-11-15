import { useEffect, useRef } from "react";
import i18n from "@/i18n";
import { onConnectionsRevoked } from "@/services/connectionRevocations";

export function revokedPhase() {
  return { tag: "error" as const, message: i18n.t("common.error.connectNotAllowed"), final: true };
}

export function useConnectionRevoked(connectionId: string | undefined, onRevoked: () => void): void {
  const callback = useRef(onRevoked);
  callback.current = onRevoked;
  useEffect(() => {
    if (!connectionId) return;
    return onConnectionsRevoked((revoked) => {
      if (revoked.has(connectionId)) callback.current();
    });
  }, [connectionId]);
}
