# Core Architecture — Plan

> Fonctionnalités fondamentales hors système de plugins.  
> Voir [PLUGIN_SYSTEM.md](PLUGIN_SYSTEM.md) pour l'écosystème de plugins.  
> Voir [SERVER.md](SERVER.md) pour l'architecture du serveur de sync.

---

## Table des matières

1. [Modèle de compte — vue d'ensemble](#1-modèle-de-compte--vue-densemble)
2. [Dérivation de clés — modèle Bitwarden](#2-dérivation-de-clés--modèle-bitwarden)
3. [Modes de fonctionnement](#3-modes-de-fonctionnement)
4. [Flux d'authentification](#4-flux-dauthentification)
5. [Session persistante — OS Keychain](#5-session-persistante--os-keychain)
6. [AccountGuard — remplacement de VaultGuard](#6-accountguard--remplacement-de-vaultguard)
7. [Mode hors-ligne](#7-mode-hors-ligne)
8. [Sécurité — problèmes connus](#8-sécurité--problèmes-connus)
9. [Roadmap core](#9-roadmap-core)

---

## 1. Modèle de compte — vue d'ensemble

Le concept de "vault password" local disparaît en tant qu'entité distincte. Il est remplacé par un **master password** unique qui est à la fois le mot de passe du compte et la source de toutes les clés cryptographiques. L'utilisateur n'a qu'une seule chose à mémoriser.

Le sel Argon2id est un **`account_id`** — UUID généré à la création du compte, fixe pour toute la vie du compte, indépendant du mode (local, Gist, serveur). Cela garantit que l'`enc_key` ne change jamais, même si l'utilisateur migre d'un mode à un autre.

```text
Master password (ne quitte JAMAIS le device)
       │
       ├─► Argon2id(master_password, account_id) ──► master_key
       │                    │
       │                    ├─► HKDF("auth") ──► auth_key
       │                    │       └─► envoyé au serveur pour login (mode serveur uniquement)
       │                    │           serveur stocke seulement hash(auth_key)
       │                    │
       │                    └─► HKDF("enc") ──► account_enc_key
       │                                └─► déverrouille Stronghold localement
       │                                    chiffre les blobs de sync
       │                                    ne quitte jamais le device
       │
       └─► Stocké dans OS Keychain après premier login
```

**`account_id`** est stocké :
- En mode **local** : dans le header non chiffré du blob (reproductible sur nouveau device via export manuel ou Gist)
- En mode **Gist** : dans le header non chiffré du Gist
- En mode **serveur** : retourné par `/auth/challenge` avant le login (voir [SERVER.md §4](SERVER.md))

**Garanties** :

- Le serveur ne voit jamais le master password
- Le serveur ne voit jamais l'`account_enc_key`
- Un attaquant qui compromet le serveur ne peut pas déchiffrer les données
- Un attaquant qui vole `vault.hold` sans le master password ne peut pas le déchiffrer (Argon2id rend le bruteforce coûteux)
- Migrer du mode local vers serveur ne nécessite aucun re-chiffrement (l'`account_enc_key` est identique)

---

## 2. Dérivation de clés — modèle Bitwarden

### Étape 1 — master_key (Argon2id)

```rust
// Paramètres Argon2id (coût intentionnellement élevé)
let params = Params::new(
    64 * 1024,  // 64 MB memory
    3,          // 3 iterations
    4,          // 4 parallelism
    Some(32),   // 32 bytes output
).unwrap();

// account_id : UUID généré à la création du compte, fixe pour toujours
let master_key = argon2id(master_password, account_id, params);  // 32 bytes
```

Le sel `account_id` garantit que deux utilisateurs avec le même mot de passe ont des `master_key` différentes, et qu'un même utilisateur a toujours la même `master_key` quel que soit son mode de sync.

### Étape 2 — auth_key et account_enc_key (HKDF)

```rust
use hkdf::Hkdf;
use sha2::Sha256;

let hkdf = Hkdf::<Sha256>::new(None, &master_key);

let mut auth_key = [0u8; 32];
hkdf.expand(b"auth", &mut auth_key).unwrap();
// → envoyé au serveur en mode serveur (le serveur stocke bcrypt/Argon2(auth_key))
// → inutilisé en mode local/Gist

let mut account_enc_key = [0u8; 32];
hkdf.expand(b"enc", &mut account_enc_key).unwrap();
// → utilisé localement pour déverrouiller Stronghold, ne quitte pas le device
// → en v1 : chiffre le blob directement
// → en v2+ (multi-vault) : devient une clé enveloppante pour les vault_keys individuelles
```

### Stronghold avec account_enc_key

```rust
// lib.rs — APRÈS refactor
tauri_plugin_stronghold::Builder::new(|key_bytes| {
    // key_bytes est déjà l'account_enc_key dérivé par HKDF côté TS
    key_bytes.to_vec()
})
```

> La dérivation lourde (Argon2id) se fait une seule fois au moment du login, pas dans le callback Stronghold.

---

## 3. Modes de fonctionnement

L'app est **local-first** : elle fonctionne entièrement sans serveur. La sync et les fonctionnalités collaboratives sont des enhancements optionnels.

| Mode | Sync | Création de compte | Multi-device | Features FUTURE.md |
| ---- | ---- | ------------------ | ------------ | ------------------ |
| **Local** | Aucune | Master password seul | Non (export manuel) | Vaults multiples locaux |
| **Gist** | GitHub Gist privé | Master password + GitHub PAT | Oui | Vaults multiples |
| **Serveur** | Serveur first-party ou self-hosted | Email + master password | Oui | Toutes |

**Premier lancement** : l'`AccountGuard` affiche un écran de choix de mode. Le mode serveur est présenté en premier (comme Termius) mais les modes local et Gist sont des alternatives de première classe, pas des options cachées.

**Migration entre modes** : toujours possible sans re-chiffrement. L'`account_enc_key` ne change pas — il suffit d'enregistrer le compte sur le nouveau backend et d'uploader le blob existant.

---

## 4. Flux d'authentification

### Premier lancement — choix de mode

```text
App start (aucun vault local détecté)
  │
  └─► AccountGuard: state = "choose-mode"
        ├─ "Continuer sans compte"  → flux local
        ├─ "Synchroniser via Gist"  → flux Gist (plugin-gist-sync)
        └─ "Créer un compte"        → flux serveur
```

---

### Mode local — création

```text
UI: "Continuer sans compte"
  master_password
    │
    ├─ Client: account_id   = UUID::new_v4()          [généré une fois]
    ├─ Client: master_key   = Argon2id(master_password, account_id)
    ├─ Client: enc_key      = HKDF(master_key, "enc")
    │
    ├─ Client: initStronghold(enc_key)                [vault local créé]
    ├─ Client: keychain.set("master_password", master_password)
    ├─ Client: keychain.set("account_id", account_id) [nécessaire au prochain démarrage]
    │
    └─ App ready
```

---

### Mode serveur — création de compte

```text
UI: "Créer un compte"
  email + master_password
    │
    ├─ Client: account_id  = UUID::new_v4()
    ├─ Client: master_key  = Argon2id(master_password, account_id)
    ├─ Client: auth_key    = HKDF(master_key, "auth")
    ├─ Client: enc_key     = HKDF(master_key, "enc")
    │
    ├─ Client: génère keypair X25519 (asymétrique)
    │          private_key → chiffré avec enc_key → stocké dans Stronghold
    │          public_key  → envoyé au serveur en clair
    │          (prépare les vaults partagés — voir FUTURE.md)
    │
    ├─ POST /auth/register { email, account_id, auth_key, public_key }
    │       └─ Serveur: stocke email + account_id + Argon2id(auth_key) + public_key + génère JWT
    │
    ├─ Client: initStronghold(enc_key)
    ├─ Client: keychain.set("master_password", master_password)
    ├─ Client: keychain.set("account_id", account_id)
    ├─ Client: keychain.set("jwt", jwt_token)
    │
    └─ App ready + premier sync déclenché
```

---

### Mode serveur — login (nouveau device ou après logout)

```text
UI: "Se connecter"
  email + master_password
    │
    ├─ GET /auth/challenge { email }
    │       └─ Serveur: retourne { account_id }   ← non authentifié
    │
    ├─ Client: master_key = Argon2id(master_password, account_id)
    ├─ Client: auth_key   = HKDF(master_key, "auth")
    ├─ Client: enc_key    = HKDF(master_key, "enc")
    │
    ├─ POST /auth/login { email, auth_key }
    │       └─ Serveur: vérifie Argon2id(auth_key) → retourne JWT
    │
    ├─ GET /sync/blob → blob chiffré téléchargé
    ├─ Client: backup_import(blob, enc_key)
    ├─ Client: initStronghold(enc_key)
    ├─ Client: keychain.set("master_password", master_password)
    ├─ Client: keychain.set("account_id", account_id)
    ├─ Client: keychain.set("jwt", jwt_token)
    │
    └─ App ready
```

> Le challenge `/auth/challenge` révèle qu'un email est enregistré (email enumeration). Pour un outil perso, c'est négligeable — Bitwarden utilise le même pattern pour retourner ses paramètres KDF.

---

### Lancement suivant (session persistante — tous modes)

```text
App start
  │
  ├─ keychain.get("master_password") + keychain.get("account_id")
  │       ├─ Succès:
  │       │    ├─ enc_key = HKDF(Argon2id(master_password, account_id), "enc")
  │       │    ├─ unlockStronghold(enc_key)
  │       │    ├─ [mode serveur] auth JWT valide ? → sync silencieux en background
  │       │    └─ App ready   ← aucune interaction utilisateur
  │       │
  │       └─ Échec (premier lancement, logout, keychain indispo)
  │            └─ AccountGuard: state = "choose-mode" ou "login"
```

---

### Logout explicite

```text
Bouton "Log out" dans settings
  → lockStronghold()
  → keychain.delete("master_password")
  → keychain.delete("account_id")
  → keychain.delete("jwt")           [si mode serveur]
  → AccountGuard: state = "choose-mode"
```

---

## 5. Session persistante — OS Keychain

Crate Rust [`keyring`](https://crates.io/crates/keyring) — API unifiée :

- **Windows** : Windows Credential Manager (DPAPI)
- **macOS** : Keychain Services
- **Linux** : Secret Service (libsecret)

Entrées stockées après login réussi :

| Clé keychain | Valeur | Usage | Modes |
| ------------ | ------ | ----- | ----- |
| `voltius/master_password` | master password en clair | Re-dériver enc_key au démarrage | Tous |
| `voltius/account_id` | UUID du compte | Sel Argon2id au démarrage | Tous |
| `voltius/jwt` | JWT token | Requêtes API serveur sans re-login | Serveur uniquement |

### Option "Toujours demander le mot de passe" (settings)

Toggle **"Lock on close"** :

- Activé → à la fermeture : `keychain.delete("master_password")` (account_id et JWT conservés)
- L'utilisateur devra ressaisir son master password au prochain lancement

---

## 6. AccountGuard — remplacement de VaultGuard

`VaultGuard.tsx` devient `AccountGuard.tsx` :

```text
États:
  loading          → vérification keychain en cours
  choose-mode      → premier lancement, aucun vault local (choix local/Gist/serveur)
  login            → vault existant mais session expirée / logout
  ready            → session restaurée automatiquement
```

```typescript
// src/components/layout/AccountGuard.tsx
type State = "loading" | "choose-mode" | "login" | "ready";

useEffect(() => {
  async function init() {
    const [password, accountId] = await Promise.all([
      invoke<string | null>("keychain_get", { key: "master_password" }),
      invoke<string | null>("keychain_get", { key: "account_id" }),
    ]);

    if (!password || !accountId) {
      const hasLocalVault = await invoke<boolean>("vault_exists");
      setState(hasLocalVault ? "login" : "choose-mode");
      return;
    }

    try {
      const encKey = await invoke<Uint8Array>("derive_enc_key", { password, accountId });
      await invoke("stronghold_unlock", { encKey });
      setState("ready");
      // Sync silencieux en background si plugin sync actif
      triggerBackgroundSync().catch(() => {});
    } catch {
      setState("login");
    }
  }
  init();
}, []);
```

---

## 7. Mode hors-ligne

- Le vault local (Stronghold) fonctionne dans tous les modes sans réseau
- Les connexions SSH, credentials, settings → tout disponible localement
- La sync est mise en queue et retentée automatiquement quand la connexion est rétablie
- **Premier lancement sans internet** : possible en mode local. En mode serveur, la création de compte nécessite le réseau ; en mode Gist, le téléchargement du blob initial aussi.

---

## 8. Sécurité — problèmes connus

### Dérivation de clé Stronghold insuffisante (priorité critique)

**Fichier** : `src-tauri/src/lib.rs`, lignes 13–24.

Le code actuel utilise `DefaultHasher` — non cryptographique, sans sel, trivial à bruteforcer.

```rust
// ACTUEL — à supprimer
tauri_plugin_stronghold::Builder::new(|password| {
    use std::collections::hash_map::DefaultHasher;
    // ...DefaultHasher...  ← NON cryptographique
})
```

**Correctif** : le callback Stronghold reçoit directement l'`account_enc_key` pré-dérivé (32 bytes) — simple pass-through :

```rust
// CIBLE
tauri_plugin_stronghold::Builder::new(|key| key.to_vec())
```

> Breaking change vis-à-vis des vaults existants. À introduire avant toute release publique.

---

## 9. Roadmap core

### Phase 1 — Sécurité & dérivation (avant toute release) ✅

- [x] Ajouter dépendances : `argon2`, `hkdf`, `sha2`, `rand`, `x25519-dalek`, `base64`, `keyring` dans `Cargo.toml`
- [x] Implémenter `derive_keys(master_password, account_id)` → `{ auth_key, enc_key }` en Rust (`src/crypto.rs`)
- [x] Implémenter `generate_keypair()` → `{ public_key, private_key_bytes }` en Rust (X25519 StaticSecret)
- [x] Exposer comme commandes Tauri `derive_keys`, `generate_keypair` (`src/commands/crypto.rs`)
- [x] Simplifier callback Stronghold → hex-decode du `enc_key` pré-dérivé (plus de DefaultHasher)

### Phase 2 — Système de compte

- [x] Ajouter dépendance `keyring` dans `Cargo.toml`
- [x] Implémenter commandes Tauri : `keychain_get`, `keychain_set`, `keychain_delete` (`src/commands/keychain.rs`)
- [x] `SplashScreen.tsx` refactorisé en AccountGuard avec états `choose-mode` / `login` / `ready` + auto-login keychain
- [x] Créer `src/services/account.ts` : `createLocalAccount()`, `createServerAccount()`, `login()`, `logout()`, `autoLogin()`
- [x] `createServerAccount()` génère le keypair et inclut `public_key` dans `POST /auth/register`
- [x] `account.ts` connecté aux endpoints serveur (challenge, register, login)
- [x] Bouton "Log out" dans le LeftPanel (bas, à côté de Settings)

### Phase 3 — Sync intégrée ✅

- [x] `backup_export` en Rust (AES-256-GCM, header cleartext + payload chiffré)
- [x] `backup_import` en Rust (déchiffrement + restore connections + retour secrets)
- [x] `account_id` dans le header non chiffré du blob
- [x] `src/services/sync.ts` : `push()`, `pull()`, `syncNow()`, `syncOnLogin()`
- [x] Sync automatique au login (`syncOnLogin` dans SplashScreen)
- [x] Background sync toutes les 5 min (`startBackgroundSync`)
- [x] Indicateur sync dans le TitleBar (icône + status + click pour forcer sync)
