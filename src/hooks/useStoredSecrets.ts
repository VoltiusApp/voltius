import { useEffect, useRef, useState } from "react";
import { getSecret } from "@/services/vault";

/**
 * Load an object's stored secrets into a form, keeping "not stored" apart from
 * "the vault could not answer". Returns true once a read has failed, so the form
 * can say the vault is unavailable rather than render an empty field that looks
 * exactly like a credential that was never saved.
 *
 * `keys` maps a form field to its secret key; a null key means the field has no
 * secret to load. `apply` receives only the fields that came back with a value.
 */
export function useStoredSecrets<K extends string>(
  id: string | undefined,
  keys: Partial<Record<K, string | null>>,
  apply: (values: Partial<Record<K, string>>) => void,
): boolean {
  const [unavailable, setUnavailable] = useState(false);
  const applyRef = useRef(apply);
  applyRef.current = apply;

  const spec = JSON.stringify(keys);

  useEffect(() => {
    if (!id) return;
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
  }, [id, spec]);

  return unavailable;
}
