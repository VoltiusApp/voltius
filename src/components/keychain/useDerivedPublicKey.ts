import { useEffect, useMemo, useRef } from "react";
import { derivePublicKey } from "@/services/publicKeyStore";
import { detectKeyInfo } from "./keyDetection";

/**
 * Fills an empty public-half field from the private half beside it.
 *
 * A key imported private-only saves without complaint and then refuses to
 * deploy — "Add to host" has nothing to append. Deriving here rather than at
 * deploy time puts the value in the visible field, where it can be read and
 * corrected, and lets the form's own save path store it.
 *
 * Quiet on failure: an encrypted key whose passphrase has not been typed yet is
 * retried as soon as it is, and anything unreadable leaves the field alone.
 */
export function useDerivedPublicKey({
  privateKey,
  publicKey,
  passphrase = "",
  enabled = true,
  onDerived,
}: {
  privateKey: string;
  publicKey: string;
  passphrase?: string;
  /** False while the field is the user's to own — one they typed, or emptied. */
  enabled?: boolean;
  onDerived: (publicKey: string) => void;
}) {
  const onDerivedRef = useRef(onDerived);
  onDerivedRef.current = onDerived;

  // Not every keystroke of a pasted key is a key: derive only once the private
  // half is a complete, recognised one.
  const complete = useMemo(() => {
    const info = detectKeyInfo(privateKey, publicKey);
    return !!info.type && info.valid;
  }, [privateKey, publicKey]);

  useEffect(() => {
    if (!enabled || !complete || publicKey.trim()) return;
    let cancelled = false;
    void derivePublicKey(privateKey.trim(), passphrase).then((result) => {
      if (!cancelled && "publicKey" in result) onDerivedRef.current(result.publicKey);
    });
    return () => { cancelled = true; };
  }, [privateKey, publicKey, passphrase, enabled, complete]);
}
