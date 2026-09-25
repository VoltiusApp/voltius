import { invoke } from "@/lib/invoke";
import type { CryptoAPI } from "../api";

export function createCryptoAPI(): CryptoAPI {
  return {
    deriveKey: (passphrase, saltHex) => invoke("derive_gist_key", { passphrase, saltHex }),
  };
}
