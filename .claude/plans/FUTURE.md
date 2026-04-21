# Vision long terme — Fonctionnalités futures

> Fonctionnalités hors scope pour la v1, documentées ici pour s'assurer que l'architecture actuelle ne les bloque pas.  
> Les plans actifs sont dans [CORE.md](CORE.md), [SERVER.md](SERVER.md) et [PLUGIN_SYSTEM.md](PLUGIN_SYSTEM.md).

---

## Table des matières

1. [Vaults multiples](#1-vaults-multiples)
2. [Vaults partagés & collaborateurs](#2-vaults-partagés--collaborateurs)
3. [Terminaux multiplayer](#3-terminaux-multiplayer)
4. [Compatibilité avec l'architecture actuelle](#4-compatibilité-avec-larchitecture-actuelle)

---

## 1. Vaults multiples

Un utilisateur peut avoir plusieurs vaults indépendants : personnel, travail, client A, client B. Chaque vault a ses propres connexions, credentials, settings et plugins. L'utilisateur switche entre vaults dans l'UI.

### Modèle crypto

En v1, l'`account_enc_key` (dérivé du master password via `account_id`) chiffre le blob directement. Avec les vaults multiples, l'`account_enc_key` devient une **clé enveloppante** : chaque vault a sa propre `vault_key` aléatoire, protégée par l'`account_enc_key`.

> **Vocabulaire** : `account_id` = UUID fixe du compte, sel Argon2id (voir [CORE.md §1](CORE.md)). `vault_id` = UUID propre à chaque vault individuel. Ce sont deux concepts distincts.

```text
master_password + account_id → account_enc_key (ne change jamais)
                                      │
                                      ├─ déchiffre vault_key_perso   (random 32 bytes, vault_id_A)
                                      │      └─► chiffre le blob du vault personnel
                                      │
                                      ├─ déchiffre vault_key_travail (random 32 bytes, vault_id_B)
                                      │      └─► chiffre le blob du vault travail
                                      │
                                      └─ déchiffre vault_key_client  (random 32 bytes, vault_id_C)
                                             └─► chiffre le blob du vault client
```

Les `vault_key` enveloppées (`account_enc_key.encrypt(vault_key)`) sont stockées sur le serveur (ou dans le Gist). Changer le master password ne nécessite de re-chiffrer que les enveloppes, pas les blobs eux-mêmes.

### Migration depuis la v1

La v1 a implicitement un seul vault (vault_id_default). La migration est un re-keying additionnel : générer un `vault_key_default` aléatoire, re-chiffrer le blob existant avec lui, stocker `account_enc_key.wrap(vault_key_default)`. L'`account_id` et l'`account_enc_key` ne changent pas.

### Disponibilité par mode — Vaults multiples

| Mode local | Mode Gist | Mode Serveur |
| ---------- | --------- | ------------ |
| Oui (vault_keys stockées dans le blob local) | Oui (vault_keys dans le Gist) | Oui |

### Changements serveur nécessaires

```sql
-- Nouvelle table vaults
CREATE TABLE vaults (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        UUID NOT NULL REFERENCES users(id),
    name_encrypted  TEXT NOT NULL,   -- nom du vault chiffré avec vault_key
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- sync_blobs prend un vault_id
ALTER TABLE sync_blobs ADD COLUMN vault_id UUID REFERENCES vaults(id);

-- Les vault_key enveloppées par account_enc_key, stockées par membre
CREATE TABLE vault_keys (
    vault_id        UUID REFERENCES vaults(id),
    user_id         UUID REFERENCES users(id),
    wrapped_key     TEXT NOT NULL,   -- account_enc_key.encrypt(vault_key), base64
    PRIMARY KEY (vault_id, user_id)
);
```

---

## 2. Vaults partagés & collaborateurs

Alice crée un vault "Infra prod" et invite Bob et Carol. Tous trois voient les mêmes connexions et credentials, avec des niveaux d'accès configurables (lecture / écriture / admin).

### Disponibilité par mode — Vaults partagés

| Mode local | Mode Gist | Mode Serveur |
| ---------- | --------- | ------------ |
| **Non** | **Non** | Oui |

> Les vaults partagés nécessitent un tiers pour l'échange de clés asymétrique (récupérer la `public_key` d'un autre utilisateur) et le stockage des `vault_keys` enveloppées par destinataire. Ce n'est pas faisable sans serveur.

### Modèle crypto — échange de clés asymétrique

C'est pour ça que chaque compte génère un keypair X25519 à la création (déjà prévu dans [CORE.md §4](CORE.md)) :

```text
INVITATION DE BOB DANS UN VAULT

Alice (owner)                        Serveur                    Bob
─────────────                        ───────                    ───
                                     ← GET /users/bob/public_key
                                         { public_key_bob }
vault_key_travail
  → chiffré avec public_key_bob
  → wrapped_key_for_bob

POST /vaults/{id}/invite →
  { user_id: bob, wrapped_key_for_bob }
                                     stocke dans vault_keys
                                                                ← GET /vaults/{id}
                                                                  { wrapped_key_for_bob }
                                                                decrypt avec private_key_bob
                                                                → vault_key_travail
                                                                → accès au vault
```

La `private_key` de Bob ne quitte jamais son device (stockée chiffrée dans son Stronghold). Le serveur voit la `public_key` de Bob (en clair, c'est normal) et le blob chiffré, jamais la `vault_key`.

### Niveaux d'accès

| Rôle | Lire | Créer/modifier | Supprimer | Inviter |
| ---- | ---- | -------------- | --------- | ------- |
| Viewer | Oui | Non | Non | Non |
| Member | Oui | Oui | Non | Non |
| Admin | Oui | Oui | Oui | Oui |
| Owner | Oui | Oui | Oui | Oui + transférer ownership |

```sql
CREATE TABLE vault_members (
    vault_id    UUID REFERENCES vaults(id),
    user_id     UUID REFERENCES users(id),
    role        TEXT NOT NULL CHECK (role IN ('viewer','member','admin','owner')),
    invited_by  UUID REFERENCES users(id),
    joined_at   TIMESTAMPTZ,
    PRIMARY KEY (vault_id, user_id)
);
```

### Révocation d'accès

Quand un membre est retiré du vault :

1. Serveur supprime son entrée dans `vault_keys` et `vault_members`
2. Owner re-génère une nouvelle `vault_key` pour le vault
3. La nouvelle `vault_key` est re-chiffrée pour tous les membres restants
4. Tous les blobs existants sont re-chiffrés avec la nouvelle `vault_key`

---

## 3. Terminaux multiplayer

Comme Termius : Alice ouvre un terminal SSH, partage la session avec Bob. Bob peut regarder en temps réel, ou prendre le contrôle (mode "pair programming").

### Disponibilité par mode — Terminaux multiplayer

| Mode local | Mode Gist | Mode Serveur |
| ---------- | --------- | ------------ |
| **Non** | **Non** | Oui |

> Les terminaux multiplayer nécessitent un relay WebSocket pour le transport temps réel entre devices. C'est une infrastructure entièrement séparée du serveur de sync, mais elle requiert une identité utilisateur (compte serveur) pour contrôler les accès.

### Architecture nécessaire

#### 3.1 Serveur relay WebSocket

```text
Alice (Tauri)                   Relay Server                    Bob (Tauri)
─────────────                   ────────────                    ───────────
SSH connect → russh
terminal output ──WS──────────► broadcast ──────────────WS──► affiche output
clavier input ◄──WS────────────  route    ◄──────────────WS── clavier input
                                (si Bob a le contrôle)
```

Le relay ne voit que des bytes de terminal chiffrés. Il n'a pas besoin de comprendre le contenu.

#### 3.2 Modifications du SessionManager Rust

Le `SessionManager` actuel utilise des canaux `mpsc` (1:1). Pour le multiplayer il faut des canaux `broadcast` (1:N) :

```rust
// Actuel (src-tauri/src/ssh/session.rs)
mpsc::channel::<Vec<u8>>()  // 1 sender → 1 receiver

// Cible multiplayer
broadcast::channel::<Vec<u8>>(256)  // 1 sender → N receivers
```

#### 3.3 Contrôle d'accès session

```typescript
interface SessionShare {
  sessionId: string;
  shareId: string;       // UUID de partage, partagé hors-bande (lien ou QR)
  role: "viewer" | "controller";
  expiresAt: string;
}
```

---

## 4. Compatibilité avec l'architecture actuelle

| Fonctionnalité future | Local | Gist | Serveur | Ce qui est déjà préparé |
| --------------------- | ----- | ---- | ------- | ----------------------- |
| Vaults multiples | Oui | Oui | Oui | `account_enc_key` extensible en clé enveloppante, modèle blob extensible à vault_id |
| Vaults partagés | **Non** | **Non** | Oui | Keypair X25519 généré à la création de compte (CORE.md) |
| Invitations | **Non** | **Non** | Oui | `public_key` stockée sur le serveur dès la v1 (SERVER.md) |
| Multiplayer terminal | **Non** | **Non** | Oui | Système de compte = base pour l'identité |
| Révocation d'accès | **Non** | **Non** | Oui | Re-keying prévu dans le modèle |

Les fonctionnalités collaboratives sont indisponibles en mode local et Gist par nature : elles nécessitent un tiers pour l'échange de clés et le transport temps réel. Ce n'est pas un manque — c'est une conséquence directe du choix local-first.
