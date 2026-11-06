const PLAIN = "master_password";
const SEALED = "master_password_sealed";
export const FORGET = "master_password_forget";

/** Emulates the vault_secret_* commands over a test keychain map; sealed values are stored as "S:<plaintext>". */
export function routeVaultSecret(
  store: Record<string, string | null>,
  cmd: string,
  args: Record<string, unknown> = {},
): { handled: boolean; value?: unknown } {
  const state = () => (store[SEALED] ? "sealed" : store[PLAIN] ? "plain" : "none");
  const done = (value?: unknown) => ({ handled: true, value });
  const replaceWithPlain = (value: string, keep = !store[FORGET]) => {
    if (keep) store[PLAIN] = value;
    else delete store[PLAIN];
    delete store[SEALED];
  };
  switch (cmd) {
    case "vault_secret_state":
      return done(state());
    case "vault_secret_seal_available":
      return done(false);
    case "vault_secret_get": {
      const s = state();
      if (s === "none") return done({ outcome: "none", value: null });
      return done({ outcome: "ok", value: s === "plain" ? store[PLAIN] : String(store[SEALED]).slice(2) });
    }
    case "vault_secret_set":
      if (state() === "sealed") store[SEALED] = `S:${args.value}`;
      else replaceWithPlain(args.value as string);
      return done("ok");
    case "vault_secret_bind":
      store[SEALED] = `S:${args.value}`;
      delete store[PLAIN];
      return done("ok");
    case "vault_secret_unbind":
      if (!store[SEALED]) return done("none");
      replaceWithPlain(String(store[SEALED]).slice(2));
      return done("ok");
    case "vault_secret_clear":
      delete store[PLAIN];
      delete store[SEALED];
      return done();
    case "vault_secret_export": {
      const s = state();
      if (s === "none") return done(null);
      return done({ kind: s, value: s === "plain" ? store[PLAIN] : store[SEALED] });
    }
    case "vault_secret_import":
      if (args.kind === "plain") replaceWithPlain(args.value as string);
      else {
        store[SEALED] = args.value as string;
        delete store[PLAIN];
      }
      return done();
    case "vault_secret_store_device_key":
      replaceWithPlain(args.value as string, true);
      return done();
    case "vault_secret_remembers":
      return done(!store[FORGET]);
    case "vault_secret_set_remembers":
      if (args.on) delete store[FORGET];
      else store[FORGET] = "1";
      return done();
    default:
      return { handled: false };
  }
}
