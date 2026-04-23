# Serveur de Sync — Plan d'architecture

> Serveur first-party E2EE pour la synchronisation des profils utilisateurs.  
> Voir [CORE.md](CORE.md) pour le modèle de dérivation de clés côté client.  
> Voir [PLUGIN_SYSTEM.md](PLUGIN_SYSTEM.md) pour le plugin-sync qui consomme ce serveur.

---

## Table des matières

1. [Principe & garanties E2EE](#1-principe--garanties-e2ee)
2. [Stack technique](#2-stack-technique)
3. [Modèle de données](#3-modèle-de-données)
4. [API REST](#4-api-rest)
5. [Authentification — protocole SRP-like](#5-authentification--protocole-srp-like)
6. [Déploiement](#6-déploiement)
7. [Self-hosting](#7-self-hosting)
8. [Roadmap serveur](#8-roadmap-serveur)

---

## 1. Principe & garanties E2EE

Le serveur est **aveugle** : il stocke des blobs qu'il ne peut pas lire, même en cas de compromission totale de la base de données.

```text
Ce que le serveur stocke          Ce que le serveur ne voit jamais
─────────────────────────         ────────────────────────────────
email (en clair pour le lookup)   master password
account_id (UUID du compte)       account_enc_key
hash(auth_key)                    encryption_key
blob chiffré opaque               connexions, credentials, clés SSH
timestamp du dernier sync         thèmes, raccourcis, données plugins
device_id (UUID aléatoire)
public_key X25519 (par nature publique)
```

`account_id` est un UUID non secret — il sert de sel Argon2id côté client (voir [CORE.md §2](CORE.md)). Le serveur le stocke et le retourne via `/auth/challenge` pour permettre la dérivation de clé sur un nouveau device sans que le client n'ait à le mémoriser.

---

## 2. Stack technique

**Rust + Axum** — cohérence avec le backend Tauri, performances natives, typage fort.

```toml
# Cargo.toml (serveur)
[dependencies]
axum = "0.7"
tokio = { version = "1", features = ["full"] }
sqlx = { version = "0.7", features = ["postgres", "runtime-tokio"] }
argon2 = "0.5"          # hachage de auth_key côté serveur
jsonwebtoken = "9"      # JWT pour les sessions
serde = { version = "1", features = ["derive"] }
serde_json = "1"
uuid = { version = "1", features = ["v4"] }
tower-http = { version = "0.5", features = ["cors", "trace"] }
```

**Base de données** : PostgreSQL.

**Structure du projet serveur** :

```text
server/
├── src/
│   ├── main.rs
│   ├── routes/
│   │   ├── auth.rs       # challenge, register, login, refresh, delete_account
│   │   └── sync.rs       # upload blob, download blob, metadata
│   ├── models/
│   │   ├── user.rs
│   │   └── sync_blob.rs
│   ├── auth/
│   │   ├── jwt.rs        # génération et validation JWT
│   │   └── password.rs   # hachage Argon2id de auth_key
│   └── db.rs             # pool SQLx
├── migrations/
│   ├── 001_create_users.sql
│   └── 002_create_sync_blobs.sql
└── Cargo.toml
```

---

## 3. Modèle de données

### Table `users`

```sql
CREATE TABLE users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       TEXT NOT NULL UNIQUE,
    account_id  UUID NOT NULL UNIQUE,  -- sel Argon2id côté client, retourné par /auth/challenge
    auth_hash   TEXT NOT NULL,         -- Argon2id(auth_key) — jamais auth_key en clair
    public_key  TEXT NOT NULL,         -- clé publique X25519 en base64 (voir FUTURE.md)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

> `account_id` est généré par le client à la création du compte et envoyé au serveur lors du register. Il n'est pas secret (UUID aléatoire), mais il est unique par compte.  
> `public_key` est stockée maintenant mais utilisée uniquement quand les vaults partagés seront implémentés (voir [FUTURE.md](FUTURE.md)).

### Table `sync_blobs`

```sql
CREATE TABLE sync_blobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id       TEXT NOT NULL,
    blob            BYTEA NOT NULL,        -- contenu chiffré opaque
    metadata        JSONB NOT NULL,        -- header non chiffré (date, counts...)
    size_bytes      INTEGER NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Un seul blob actif par (user, device)
    UNIQUE (user_id, device_id)
);

CREATE INDEX idx_sync_blobs_user ON sync_blobs(user_id);
```

Chaque device maintient son propre blob. Le serveur ne merge jamais — la résolution de conflits est côté client (voir PLUGIN_SYSTEM.md §plugin-sync).

---

## 4. API REST

Base URL : `https://api.voltius.app/v1` (ou URL self-hosted)

### Authentification

```text
GET /auth/challenge?email=<email>
→ 200 { account_id: string }   ← non authentifié
→ 404 email non trouvé
(permet au client de récupérer account_id pour dériver auth_key avant le login)

POST /auth/register
Body : { email: string, account_id: string, auth_key: string, public_key: string }
→ 201 { user_id, jwt_token, refresh_token }
→ 409 email déjà utilisé

POST /auth/login
Body : { email: string, auth_key: string }
→ 200 { user_id, jwt_token, refresh_token }
→ 401 credentials invalides

POST /auth/refresh
Body : { refresh_token: string }
→ 200 { jwt_token }
→ 401 refresh token expiré ou révoqué

DELETE /auth/account
Header : Authorization: Bearer <jwt>
→ 204 compte + tous les blobs supprimés
```

### Sync

```text
GET /sync/blob
Header : Authorization: Bearer <jwt>
Query  : ?device_id=<uuid>  (optionnel, défaut = blob le plus récent tous devices)
→ 200 { blob: base64, metadata: {...}, updated_at: ISO8601 }
→ 404 aucun blob pour ce device

PUT /sync/blob
Header : Authorization: Bearer <jwt>
Body   : { device_id: string, blob: base64, metadata: object }
→ 200 { updated_at: ISO8601 }

GET /sync/devices
Header : Authorization: Bearer <jwt>
→ 200 { devices: [{ device_id, metadata, updated_at }] }

DELETE /sync/blob/:device_id
Header : Authorization: Bearer <jwt>
→ 204
```

### JWT

- Access token : durée 15 minutes
- Refresh token : durée 90 jours, rotation à chaque usage
- Le client stocke les deux dans l'OS keychain (voir CORE.md §5)

---

## 5. Authentification — protocole SRP-like

Le client ne doit jamais envoyer le master password au serveur. Le login se fait en deux étapes pour permettre la dérivation de clé côté client avec l'`account_id` comme sel.

```text
REGISTER
  Client                                    Serveur
  ──────                                    ───────
  account_id = UUID::new_v4()
  master_key = Argon2id(password, account_id)
  auth_key   = HKDF(master_key, "auth")
  POST /auth/register                      →
  { email, account_id, auth_key, public_key }
                                            auth_hash = Argon2id(auth_key)
                                            INSERT users(email, account_id, auth_hash, public_key)
                                           ← { jwt, refresh_token }

LOGIN (nouveau device)
  Client                                    Serveur
  ──────                                    ───────
  GET /auth/challenge?email=...            →
                                           ← { account_id }
  master_key = Argon2id(password, account_id)
  auth_key   = HKDF(master_key, "auth")
  POST /auth/login                         →
  { email, auth_key }
                                            Argon2id.verify(auth_key, auth_hash)
                                           ← { jwt, refresh_token }
```

Le serveur stocke `Argon2id(auth_key)` — pas `auth_key` lui-même. Même si la BDD est compromise, l'attaquant ne peut pas reconstruire l'`account_enc_key` (qui nécessite le master password, pas l'`auth_key`).

> `/auth/challenge` est non authentifié et révèle qu'un email est enregistré. C'est un compromis délibéré (identique à l'approche Bitwarden) pour éviter que le client ne mémorise l'`account_id` séparément de ses credentials.

---

## 6. Déploiement

### Infrastructure minimale (MVP)

```text
[Client Tauri] ──HTTPS──► [Serveur Axum] ──► [PostgreSQL]
```

- **Serveur** : VPS simple (2 vCPU, 2 GB RAM suffisent pour des milliers d'utilisateurs — les blobs sont petits)
- **Base de données** : PostgreSQL managé (Railway, Supabase, Neon, ou auto-hébergé)
- **TLS** : Let's Encrypt via reverse proxy (Caddy recommandé)
- **Stockage blobs** : en base (BYTEA) pour l'instant — migrable vers S3/R2 si les blobs deviennent grands

### Limites côté serveur

| Limite | Valeur | Raison |
| ------ | ------ | ------ |
| Taille max blob | 5 MB | Les profils avec centaines de connexions + clés privées restent sous 1 MB |
| Devices par compte | 20 | Prévenir l'abus |
| Requêtes sync | 60/heure | Rate limiting par user_id |
| Requêtes auth | 10/minute | Brute force protection |

### Caddy (reverse proxy recommandé)

```text
api.voltius.app {
    reverse_proxy localhost:8080
}
```

---

## 7. Self-hosting

Pour les power users ou entreprises qui ne veulent pas utiliser le serveur first-party.

Le client expose un champ **"Custom server URL"** dans les settings du plugin-sync. L'URL remplace `https://api.voltius.app/v1` pour toutes les requêtes.

Le serveur est distribué comme :

- **Image Docker** : `docker run -e DATABASE_URL=... -p 8080:8080 voltius/sync-server`
- **Binaire compilé** : release GitHub pour Linux x86_64/arm64

```dockerfile
FROM rust:1.75-slim AS builder
WORKDIR /app
COPY . .
RUN cargo build --release

FROM debian:bookworm-slim
COPY --from=builder /app/target/release/voltius-server /usr/local/bin/
ENV PORT=8080
CMD ["voltius-server"]
```

Variables d'environnement :

```bash
DATABASE_URL=postgres://user:pass@host/db
JWT_SECRET=<32 bytes aléatoires>
PORT=8080
MAX_BLOB_SIZE_MB=5
```

---

## 8. Roadmap serveur

### Phase 1 — MVP fonctionnel

- [x] Scaffold Axum avec routes auth + sync (`server/src/main.rs`, routes, auth, models)
- [x] Migrations SQL (users + sync_blobs) avec colonne `account_id`
- [x] Implémentation Argon2id pour hachage auth_key (`auth/password.rs`)
- [x] Endpoint `/auth/challenge` (retourne `account_id` par email)
- [x] JWT avec refresh token rotation (`auth/jwt.rs` — access 15min, refresh 90j)
- [x] Rate limiting per-IP (`rate_limit.rs` — auth: 10/min, sync: 60/h, sliding window)
- [ ] Tests d'intégration (register → challenge → login → upload → download)
- [ ] Déploiement sur VPS + Caddy + PostgreSQL managé

### Phase 2 — Production-ready

- [x] Healthcheck `/health` (déjà implémenté)
- [x] Logs structurés (tracing + env-filter)
- [x] Endpoint de suppression de compte RGPD (`DELETE /v1/auth/account`)
- [ ] Monitoring (métriques Prometheus)
- [ ] Backup automatique BDD
- [ ] Image Docker + release binaires GitHub

### Phase 3 — Scale & features

- [ ] Migration blobs vers S3/R2 si taille moyenne > 1 MB
- [x] Endpoint liste des devices avec metadata (`GET /v1/sync/devices`)
- [ ] Notifications push optionnelles (sync disponible sur autre device)
- [ ] Tableau de bord admin minimal (nb utilisateurs, espace utilisé)
