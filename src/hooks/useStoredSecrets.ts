import { useEffect, useRef, useState } from "react";
import { getSecret } from "@/services/vault";
import { usePermissions } from "@/hooks/usePermission";

/**
 * `ok`          — the fields hold whatever was stored.
 * `unavailable` — the vault could not be read; the fields are empty for a
 *                 reason that has nothing to do with what was saved.
 * `forbidden`   — the caller's role in this vault lacks VIEW_SECRETS, so the
 *                 plaintext is deliberately not loaded (issue #190). A
 *                 connect-only member still connects: the terminal reads the
 *                 keychain directly, never this form.
 */
export type StoredSecretsState = "ok" | "unavailable" | "forbidden";

/**
 * Load an object's stored secrets into a form, keeping "not stored" apart from
 * "the vault could not answer" and from "your role may not see these". Without
 * the distinction an empty field is indistinguishable from a credential that
 * was never saved — and typing a guess into one replaces the real secret.
 *
 * `keys` maps a form field to its secret key; a null key means the field has no
 * secret to load. `apply` receives only the fields that came back with a value.
 */
export function useStoredSecrets<K extends string>(
  id: string | undefined,
  vaultId: string | undefined,
  keys: Partial<Record<K, string | null>>,
  apply: (values: Partial<Record<K, string>>) => void,
): StoredSecretsState {
  const can = usePermissions();
  const mayView = can("VIEW_SECRETS", vaultId || "personal");
  const [unavailable, setUnavailable] = useState(false);
  const applyRef = useRef(apply);
  applyRef.current = apply;

  const spec = JSON.stringify(keys);

  useEffect(() => {
    if (!id || !mayView) return;
    let cancelled = false;

    void (async () => {
      const wanted = Object.entries(JSON.parse(spec) as Record<string, string | null>)
        .filter((entry): entry is [string, string] => !!entry[1]);

      const values: Record<string, string> = {};
      let failed = false;
      for (const [field, key] of wanted) {
        try {
          const value = await getSecret(key);
          if (value) values[field] = value;
        } catch {
          failed = true;
        }
      }

      if (cancelled) return;
      setUnavailable(failed);
      applyRef.current(values as Partial<Record<K, string>>);
    })();

    return () => {
      cancelled = true;
    };
  }, [id, spec, mayView]);

  if (!mayView) return "forbidden";
  return unavailable ? "unavailable" : "ok";
}
