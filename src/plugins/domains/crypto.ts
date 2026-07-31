import { invoke } from "@tauri-apps/api/core";
import type { CryptoAPI } from "../api";

export function createCryptoAPI(): CryptoAPI {
  return {
    deriveKey: (passphrase, saltHex) => invoke("derive_gist_key", { passphrase, saltHex }),
  };
}
