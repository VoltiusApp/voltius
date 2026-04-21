# Voltius — Team Features : Plan d'Implémentation

> **Philosophie** : Chaque phase est autonome et livrable. La suivante dépend de la précédente.
> Le serveur `server/` (Axum + PostgreSQL) est étendu tout au long — pas de nouveau service.

---

## Statut d'avancement

| Phase | Description | Statut |
|---|---|---|
| Phase 1 | Multi-user & Foundation DB | ✅ **Livré** (minimal: teams + team_members + endpoints REST) |
| Phase 2 | Shared Vault Encryption (E2EE) | ✅ **Livré** (X25519 keypair déterministe via HKDF, wrap/unwrap session key) |
| Phase 3 | RBAC : Rôles Built-in | ⏳ Partiel (built-in roles stockés + hook frontend ; enforcement serveur manquant sur endpoints sensibles) |
| Phase 4 | Custom Roles (façon Discord) | ⏳ **~95% — non testé** (CRUD complet, bitmask, UI, enforcement serveur ; invite custom role déjà implémenté) |
| Phase 5 | Item-level Permissions & Sync Conditionnel | ❌ À faire |
| Phase 6 | Audit Logging | ❌ À faire |
| Phase 7 | Multiplayer Terminal | ✅ **Livré** (relay WebSocket, E2EE AES-GCM, Share button, guest output, host broadcast, contrôle dynamique) |
| Phase 8 | Connect-Only SSH Proxy | ❌ À faire (optionnel) |

### Ce qui est implémenté (Phase 4 — détail, mise à jour 2026-04-11)
- **DB** : migration `008_custom_roles.sql` — table `custom_roles` (id, team_id, name, permissions BIGINT, created_at) + colonne `team_members.custom_role_id` FK
- **Server** : 4 endpoints CRUD dans `server/src/routes/teams.rs` :
  - `GET /v1/teams/:team_id/roles` — liste tous les rôles (built-in simulés + custom en DB)
  - `POST /v1/teams/:team_id/roles` — créer (Owner only, permissions clampées à 0x7FFF)
  - `PATCH /v1/teams/:team_id/roles/:role_id` — modifier (Owner only)
  - `DELETE /v1/teams/:team_id/roles/:role_id` — supprimer (Owner only, 409 si rôle assigné)
- **Frontend** :
  - `teamService.ts` : `listCustomRoles`, `createCustomRole`, `updateCustomRole`, `deleteCustomRole`, `assignCustomRole`
  - `teamStore.ts` : état `customRolesByTeam`, actions correspondantes
  - `usePermission.ts` : hook avec 15 bits de permissions, bitmask correct (0x7FFF owner, etc.), fallback built-in roles
  - `RolesSection.tsx` (489 lignes) : `BuiltinRoleCard`, `CustomRoleCard`, `RoleModal` (create/edit), `PermissionGrid` (15 cases), `TeamRolesPanel`
  - Accessible via **Settings > Vaults > [team vault] > onglet Roles** (pas de section top-level)

### Ce qui est implémenté (Phase 7 — détail)
- **Server** : `terminal_sessions` + `terminal_session_keys` tables, REST endpoints CRUD, WebSocket relay avec tokio broadcast channels, fan-out chiffré E2EE, contrôle dynamique (request/grant/revoke)
- **Tauri** : `derive_x25519_keypair`, `x25519_wrap_key`, `x25519_unwrap_key` (crypto commands)
- **Frontend** :
  - `multiplayerService.ts` : WebCrypto AES-GCM, X25519 ECDH, session key management, WebSocket client
  - `teamSessionStore.ts` : `startSharing` / `joinSession` / `stopSharing` / `leaveSession` + contrôle
  - `useMultiplayerHostBroadcast` hook : écoute `ssh-output-{id}` → envoie sur WebSocket
  - `MultiplayerTerminalView` : xterm.js pour guests, `_termWrite` wired via store
  - `MultiplayerBar` : barre participante, contrôle, stop/leave
  - `TeamSessions` : section homepage avec polling, cartes Live, join
  - `TitleBar` : bouton **Share** avec dropdown de sélection d'équipe, état "Sharing"
  - `MainPanel` : `HostAwareTerminalView` injecte le broadcast hook + affiche `MultiplayerBar` sous les terminaux SSH partagés

### Ce qui reste à faire (priorité suggérée)
1. **Phase 4 — finaliser & tester** : enforcement côté serveur des bits de permission custom (POST identity/key/connection/terminal), dropdown custom roles dans InviteBar, tests manuels
2. **Phase 3 complète** : middleware `require_permission` Axum vérifiant les bitmasks sur les endpoints sensibles (partagé avec Phase 4)
3. **Phase 6** : Audit logging (table + middleware + page UI)
4. **Phase 5** : Item-level permissions + sync conditionnel
5. **Phase 8** : SSH Proxy Connect-Only (optionnel, complexe)

### Corrections post-livraison Phase 7
- ✅ Supprimé "Anyone on this instance" (partage instance entière)
- ✅ Supprimé "Invite a user" (hors scope)
- ✅ Multi-vault : partager avec 1+ vaults simultanément (migration 006 + `terminal_session_vaults`)
- ✅ Role filter : restreindre par rôle dans les vaults sélectionnés (`allowed_roles TEXT[]`)
- ✅ Invite link : lien/token basé sur `invite_token` (remplace public session sans E2EE)
- Le display name est hardcodé à "Me" dans `TeamSessions.tsx` → utiliser le vrai nom d'utilisateur
- Pas de gestion d'erreur UI si `startSharing` échoue (juste `console.error`)
- Timeout inactivité non implémenté (prévu dans le plan à 30min)
- P2P WebRTC non implémenté (fallback WS uniquement pour l'instant)
- "Join by invite code" UI pas encore implémenté (le code est généré mais pas de champ de saisie pour le coller)

---

## Vue d'ensemble des phases

```
Phase 1 — Multi-user & Foundation DB          ✅
Phase 2 — Shared Vault Encryption (E2EE)      ✅
Phase 3 — RBAC : Rôles Built-in               ⏳ (enforcement serveur manquant)
Phase 4 — Custom Roles (façon Discord)         ⏳ (~85%, non testé)
Phase 5 — Item-level Permissions & Sync        ❌
Phase 6 — Audit Logging                        ❌
Phase 7 — Multiplayer Terminal                 ✅
Phase 8 — Connect-Only SSH Proxy (avancé)      ❌
```

---

## Phase 1 — Multi-user & Foundation DB

> **Prérequis pour tout le reste.** Sans ça, rien ne peut être partagé.

### Objectif
Permettre à plusieurs utilisateurs d'exister dans le même espace (vault partagé),
gérer les invitations, et représenter les équipes en base.

### Backend (`server/`)

**Nouvelles tables PostgreSQL :**

```sql
-- Un "vault" partagé appartient à une team
CREATE TABLE teams (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Membres d'une team (rôle stocké ici — voir Phase 3)
CREATE TABLE team_members (
  team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id     UUID,  -- NULL = rôle par défaut "Membre" ; rempli en Phase 3
  invited_by  UUID REFERENCES users(id),
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id)
);

-- Invitations (token envoyé par email / lien)
CREATE TABLE invitations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  invited_by  UUID NOT NULL REFERENCES users(id),
  email       TEXT NOT NULL,
  token       TEXT NOT NULL UNIQUE,  -- UUID aléatoire
  role_id     UUID,                  -- rôle assigné à l'acceptation
  expires_at  TIMESTAMPTZ NOT NULL,  -- ex: NOW() + INTERVAL '7 days'
  accepted_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Vault partagé (lié à une team — clé chiffrée ajoutée en Phase 2)
CREATE TABLE shared_vaults (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Nouveaux endpoints Axum :**

```
POST   /v1/teams                        — créer une team
GET    /v1/teams                        — lister mes teams
GET    /v1/teams/:team_id               — détail team + membres
DELETE /v1/teams/:team_id               — supprimer (Owner only)

POST   /v1/teams/:team_id/invite        — envoyer une invitation (email + role_id)
POST   /v1/invitations/:token/accept    — accepter l'invitation (auth required)
DELETE /v1/teams/:team_id/members/:uid  — retirer un membre

GET    /v1/teams/:team_id/vaults        — lister les vaults partagés
POST   /v1/teams/:team_id/vaults        — créer un vault partagé
```

### Frontend

- **Vault switcher** dans la sidebar : "Personnel" + liste des vaults partagés rejoints
- **Page Settings > Team** : liste des membres, bouton "Inviter", rôle affiché
- **Page d'acceptation d'invitation** : vue dédiée au lancement de l'app via deep-link
  ou depuis le portail web si existant
- Store Zustand `teamStore` : team active, membres, vault actif

### Notes importantes
- Le vault "Personnel" reste inchangé — clé dérivée du mot de passe, aucun partage.
- Un utilisateur peut appartenir à N teams avec des rôles différents dans chacune.
- L'Owner d'une team ne peut pas être retiré.

---

## Phase 2 — Shared Vault Encryption (E2EE)

> **La partie la plus délicate cryptographiquement.** On ne casse pas l'E2EE.

### Problème
Aujourd'hui, la clé de chiffrement de chaque utilisateur est dérivée de son mot de passe.
Pour un vault partagé, plusieurs personnes doivent pouvoir déchiffrer les mêmes données,
sans que le serveur n'ait jamais accès à la clé en clair.

### Solution : Vault Key + Per-member Wrapped Keys

Schéma inspiré de Bitwarden Organizations et Signal Sealed Sender :

```
1. À la création du vault partagé :
   - Générer une clé symétrique aléatoire : VaultKey (256 bits AES)
   - Pour chaque membre autorisé, chiffrer VaultKey avec la PublicKey X25519 du membre
     → wrapped_vault_key = X25519_Encrypt(member_public_key, VaultKey)
   - Stocker wrapped_vault_key en base, par (vault_id, user_id)

2. Quand un membre ouvre le vault :
   - Récupérer son wrapped_vault_key depuis le serveur
   - Déchiffrer avec sa PrivateKey X25519 (dérivée de son mot de passe) → VaultKey
   - Déchiffrer les données du vault avec VaultKey (AES-256-GCM)

3. Quand un nouveau membre est invité :
   - L'Owner (ou Manager) déchiffre VaultKey côté client
   - Rechiffre VaultKey avec la PublicKey du nouveau membre
   - Upload le nouveau wrapped_vault_key

4. Quand un membre est retiré :
   - Générer une nouvelle VaultKey
   - Re-chiffrer pour tous les membres restants
   - Re-chiffrer toutes les données du vault avec la nouvelle VaultKey
   → "Key Rotation"
```

**La PrivateKey X25519** est déjà préfigurée dans le code. Elle doit être dérivée de
`master_password` via le même pipeline `Argon2id → HKDF` existant, sur un slot dédié.

### Nouvelles tables PostgreSQL :

```sql
-- Clé du vault, wrappée par membre
CREATE TABLE vault_member_keys (
  vault_id         UUID NOT NULL REFERENCES shared_vaults(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wrapped_key      BYTEA NOT NULL,   -- X25519_Encrypt(member_pub_key, VaultKey)
  key_version      INTEGER NOT NULL DEFAULT 1,  -- pour la rotation
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (vault_id, user_id)
);

-- Blob chiffré du vault partagé (remplace/complète sync_blobs pour les shared vaults)
CREATE TABLE shared_vault_blobs (
  vault_id    UUID NOT NULL REFERENCES shared_vaults(id) ON DELETE CASCADE,
  device_id   TEXT NOT NULL,
  blob        BYTEA NOT NULL,        -- chiffré avec VaultKey
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (vault_id, device_id)
);
```

### Endpoints supplémentaires :

```
GET    /v1/vaults/:vault_id/my-key     — récupérer ma wrapped_vault_key
PUT    /v1/vaults/:vault_id/keys       — (Owner/Manager) uploader les wrapped keys
POST   /v1/vaults/:vault_id/rotate     — rotation de clé (re-chiffrement complet)
GET    /v1/vaults/:vault_id/blob       — télécharger le blob du vault
PUT    /v1/vaults/:vault_id/blob       — uploader le blob du vault
```

### Frontend

- Lors de la création d'un vault partagé : génération VaultKey en Rust (via Tauri command)
- `cryptoService` : nouvelles fonctions `wrapVaultKey`, `unwrapVaultKey`, `rotateVaultKey`
- Le `syncService` détecte si le vault actif est partagé et utilise les bons endpoints

---

## Phase 3 — RBAC : Rôles Built-in

> Définir et enforcer les rôles Owner, Manager, Editor, Membre, Connect-Only.

### Modèle de permissions

Chaque permission est un bit dans un entier (ou un champ booléen dans une table).
On définit 15 permissions granulaires :

| Code | Description |
|------|-------------|
| `VIEW_SECRETS` | Voir les mots de passe / clés SSH en clair |
| `COPY_SECRETS` | Copier dans le presse-papier |
| `CONNECT` | Lancer une connexion SSH |
| `EDIT_CONNECTIONS` | Créer / modifier / supprimer des connexions |
| `EDIT_IDENTITIES` | Créer / modifier / supprimer des identités SSH |
| `EDIT_KEYS` | Créer / modifier / supprimer des clés SSH |
| `EDIT_FOLDERS` | Gérer l'arborescence de dossiers |
| `VIEW_AUDIT_LOG` | Consulter les logs d'audit |
| `INVITE_MEMBERS` | Inviter de nouveaux membres dans le vault |
| `MANAGE_MEMBERS` | Modifier les rôles, retirer des membres |
| `CREATE_CUSTOM_ROLES` | Créer / modifier / supprimer des rôles custom |
| `MANAGE_VAULT` | Renommer le vault, gérer les paramètres |
| `START_TERMINAL_SESSION` | Lancer une session multiplayer |
| `JOIN_TERMINAL_SESSION` | Rejoindre une session existante |
| `VIEW_TERMINAL_SESSIONS` | Voir la liste des sessions actives |

### Rôles built-in et leurs permissions par défaut

| Permission | Owner | Manager | Editor | Membre | Connect-Only |
|---|:---:|:---:|:---:|:---:|:---:|
| VIEW_SECRETS | ✅ | ✅ | ✅ | ✅ | ❌ |
| COPY_SECRETS | ✅ | ✅ | ✅ | ✅ | ❌ |
| CONNECT | ✅ | ✅ | ✅ | ✅ | ✅ |
| EDIT_CONNECTIONS | ✅ | ✅ | ✅ | ❌ | ❌ |
| EDIT_IDENTITIES | ✅ | ✅ | ✅ | ❌ | ❌ |
| EDIT_KEYS | ✅ | ✅ | ✅ | ❌ | ❌ |
| EDIT_FOLDERS | ✅ | ✅ | ✅ | ❌ | ❌ |
| VIEW_AUDIT_LOG | ✅ | ✅ | ❌ | ❌ | ❌ |
| INVITE_MEMBERS | ✅ | ✅ | ❌ | ❌ | ❌ |
| MANAGE_MEMBERS | ✅ | ✅ | ❌ | ❌ | ❌ |
| CREATE_CUSTOM_ROLES | ✅ | ❌ | ❌ | ❌ | ❌ |
| MANAGE_VAULT | ✅ | ❌ | ❌ | ❌ | ❌ |
| START_TERMINAL_SESSION | ✅ | ✅ | ✅ | ✅ | ✅ |
| JOIN_TERMINAL_SESSION | ✅ | ✅ | ✅ | ✅ | ✅ |
| VIEW_TERMINAL_SESSIONS | ✅ | ✅ | ✅ | ✅ | ✅ |

### Nouvelles tables PostgreSQL :

```sql
-- Rôles (built-in + custom)
CREATE TABLE roles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id      UUID REFERENCES teams(id) ON DELETE CASCADE,  -- NULL = built-in global
  name         TEXT NOT NULL,
  is_builtin   BOOLEAN NOT NULL DEFAULT FALSE,
  permissions  BIGINT NOT NULL DEFAULT 0,  -- bitmask des 15 permissions
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed des rôles built-in (migration)
INSERT INTO roles (id, name, is_builtin, permissions) VALUES
  ('00000001-...', 'Owner',        TRUE, 0b111111111111111),
  ('00000002-...', 'Manager',      TRUE, 0b011111111011111),
  ('00000003-...', 'Editor',       TRUE, 0b001111100001111),
  ('00000004-...', 'Membre',       TRUE, 0b000000100000111),
  ('00000005-...', 'Connect-Only', TRUE, 0b000000000010100);
-- (valeurs exactes à calculer selon le tableau ci-dessus)
```

Le champ `role_id` dans `team_members` (Phase 1) pointe vers cette table.

### Enforcement côté serveur

Chaque endpoint sensible vérifie les permissions avant d'agir :

```rust
// Middleware Axum : injecter les permissions de l'utilisateur courant
async fn require_permission(
    perm: Permission,
    vault_id: Uuid,
    user_id: Uuid,
    db: &PgPool,
) -> Result<(), AppError> { ... }
```

### Frontend

- Hook React `usePermission(perm: Permission): boolean`
- Les boutons/actions sensibles sont cachés ou désactivés si permission absente
- Badge du rôle affiché dans la liste des membres
- **Connect-Only** : les champs mot de passe / clé privée sont remplacés par `••••••••`
  et le bouton "Copier" est absent

---

## Phase 4 — Custom Roles (façon Discord)

> Extension naturelle de la Phase 3.

### Objectif
Permettre à l'Owner de créer des rôles nommés avec exactement les permissions qu'il choisit.

### Backend

- Utilise la même table `roles` avec `is_builtin = FALSE` et `team_id` rempli
- Endpoints :
  ```
  GET    /v1/teams/:team_id/roles          — lister tous les rôles (built-in + custom)
  POST   /v1/teams/:team_id/roles          — créer un rôle custom
  PATCH  /v1/teams/:team_id/roles/:role_id — modifier les permissions d'un rôle custom
  DELETE /v1/teams/:team_id/roles/:role_id — supprimer (interdit si des membres l'ont)
  ```
- Contrainte : impossible de supprimer un rôle built-in, impossible de donner plus de
  permissions que l'Owner actuel.

### Frontend

- Page **Settings > Roles** :
  - Liste des rôles (built-in en lecture seule, custom éditables)
  - Bouton "Créer un nouveau rôle"
  - Modal : champ Nom + 15 cases à cocher avec description de chaque permission
  - Les rôles custom apparaissent dans le sélecteur lors des invitations

---

## Phase 5 — Item-level Permissions & Sync Conditionnel

> Granularité maximale : Jean ne reçoit pas même le blob chiffré de DB-PROD.

### Modèle choisi : Métadonnées d'accès en clair côté serveur

Le serveur ne voit jamais le contenu d'un item (toujours chiffré).
Mais il stocke en clair quels `item_id` sont accessibles par quels `user_id`.
Le contenu chiffré ne descend jamais sur le disque d'un utilisateur non autorisé.

**Compromis assumé** : le serveur connaît les IDs des items et leur liste d'accès.
C'est identique à ce que fait Bitwarden avec les Collections. Acceptable pour un outil
d'équipe, où le serveur est de confiance (self-hosted ou SaaS propriétaire).

### Nouvelles tables PostgreSQL :

```sql
-- Permission explicite sur un item pour un user (optionnelle — par défaut = rôle du vault)
CREATE TABLE item_permissions (
  vault_id    UUID NOT NULL REFERENCES shared_vaults(id) ON DELETE CASCADE,
  item_id     TEXT NOT NULL,           -- ID de la connexion / identité / clé / dossier
  item_type   TEXT NOT NULL,           -- 'connection' | 'identity' | 'key' | 'folder'
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  granted     BOOLEAN NOT NULL,        -- TRUE = accès accordé, FALSE = explicitement refusé
  granted_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (vault_id, item_id, user_id)
);
```

### Logique de résolution des permissions (priorité décroissante)
```
1. item_permissions explicite (granted=FALSE) → REFUS
2. item_permissions explicite (granted=TRUE)  → ACCÈS
3. Rôle du membre dans le vault              → selon le tableau Phase 3
```

### Sync conditionnel

Quand un utilisateur demande le blob du vault, le serveur :
1. Récupère la liste des `item_id` auxquels il n'a pas accès
2. Le blob étant chiffré et opaque, **le client est responsable** de filtrer
   avant d'uploader : le client n'inclut dans le blob que les items qu'il a le droit
   de partager.
3. Le serveur vérifie que le blob uploadé ne contient pas d'items interdits
   → nécessite un **manifest en clair** dans le header du blob (liste des item_ids présents)

**Structure du blob partagé (extension du format actuel) :**
```
[4 bytes: header_len]
[header JSON: { version, vault_id, device_id, item_manifest: ["id1","id2",...] }]
[12 bytes: nonce]
[AES-256-GCM ciphertext]
```

Le serveur lit le `item_manifest` (en clair) et refuse l'upload si un item_id
est présent alors que l'uploadeur n'a pas les droits dessus.

### Frontend

- Dans les détails d'une connexion : section "Accès" listant qui peut y accéder
- Modal pour ajouter/retirer l'accès d'un membre spécifique (Owner/Manager seulement)
- Indicateur visuel sur les items avec permissions restreintes

---

## Phase 6 — Audit Logging

> Traçabilité complète de toutes les actions sensibles.

### Backend

**Nouvelle table :**
```sql
CREATE TABLE audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  vault_id    UUID REFERENCES shared_vaults(id),
  actor_id    UUID NOT NULL REFERENCES users(id),
  action      TEXT NOT NULL,      -- voir enum ci-dessous
  target_type TEXT,               -- 'user' | 'connection' | 'vault' | 'session' | 'role'
  target_id   TEXT,               -- UUID de la cible
  target_name TEXT,               -- snapshot du nom au moment de l'action
  metadata    JSONB,              -- détails supplémentaires (ex: ancien rôle → nouveau rôle)
  ip_address  INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX audit_logs_team_id_idx ON audit_logs(team_id);
CREATE INDEX audit_logs_created_at_idx ON audit_logs(created_at DESC);
```

**Actions loguées (enum) :**
```
vault.created, vault.deleted, vault.renamed
member.invited, member.joined, member.removed, member.role_changed
connection.created, connection.updated, connection.deleted
identity.created, identity.updated, identity.deleted
key.created, key.deleted
secret.viewed (VIEW_SECRETS utilisé)
session.started, session.ended, session.joined, session.left
session.control_requested, session.control_granted, session.control_denied
role.created, role.updated, role.deleted
permission.granted, permission.revoked
vault.key_rotated
```

**Middleware Axum :**
```rust
// Macro ou wrapper qui log automatiquement après chaque handler réussi
log_audit!(conn, actor_id, "member.invited", target_type="user", target_id=invitee_id);
```

**Endpoints :**
```
GET /v1/teams/:team_id/audit-logs
  ?page=1&per_page=50
  &action=member.invited
  &actor_id=...
  &from=2025-01-01&to=2025-12-31
```

### Frontend

- Page **Settings > Audit Log** (visible Owner + Manager uniquement, via `VIEW_AUDIT_LOG`)
- Timeline avec icônes par type d'action, avatar de l'acteur, horodatage
- Filtres : acteur, type d'action, plage de dates
- Export CSV

---

## Phase 7 — Multiplayer Terminal

> Partager un terminal en direct entre membres du vault.

### Architecture

```
Client A (Host)          Server (Relay)          Client B (Guest)
     |                        |                        |
     |── WS connect ─────────>|<──── WS connect ───────|
     |── SSH connect ─────────> (via russh dans Tauri)  |
     |                        |                        |
     |<══ terminal data (E2EE)═══════════════════════>|
     |                        |                        |
     |── control_request ─────────────────────────────>|
     |<── control_granted ────────────────────────────|
     |                        |                        |
```

**Le serveur est un relay** : il ne voit jamais le contenu du terminal.
La session E2EE : chaque session a une **Session Key** éphémère (AES-256-GCM),
chiffrée pour chaque participant avec leur PublicKey X25519 (même mécanisme que Phase 2).

### Backend — WebSocket Relay

Nouveau module `server/src/terminal/` :

```rust
// Gestion des sessions
struct TerminalSession {
    id: Uuid,
    vault_id: Uuid,
    host_user_id: Uuid,
    visibility: SessionVisibility,
    allowed_role_ids: Vec<Uuid>,   // si visibility == "roles_only"
    allowed_user_ids: Vec<Uuid>,   // si visibility == "members_only"
    participants: HashMap<Uuid, WsSink>,
    control_holder: Uuid,          // qui écrit actuellement
    pending_control_request: Option<Uuid>,
    session_key_wrapped: HashMap<Uuid, Vec<u8>>,  // wrapped Session Key par user
    created_at: DateTime<Utc>,
}

enum SessionVisibility {
    Public,        // tous les membres du vault
    RolesOnly,     // membres ayant certains rôles
    MembersOnly,   // liste explicite de membres
    Private,       // sur invitation directe uniquement
}
```

**Messages WebSocket (JSON) :**
```jsonc
// Host → Server → Guests : données terminal
{ "type": "terminal_data", "data": "<base64 AES-GCM encrypted chunk>" }

// Guest → Server → Host : demande de contrôle
{ "type": "control_request", "user_id": "..." }

// Host → Server → Guest : accorder/refuser le contrôle
{ "type": "control_response", "granted": true, "user_id": "..." }

// Tous → tous : présence
{ "type": "participant_joined", "user_id": "...", "display_name": "..." }
{ "type": "participant_left",   "user_id": "..." }

// Host → Server : configuration de visibilité
{ "type": "session_config", "visibility": "roles_only", "allowed_role_ids": ["..."] }
```

**Endpoints HTTP (avant connexion WS) :**
```
POST /v1/vaults/:vault_id/terminal-sessions        — créer une session
GET  /v1/vaults/:vault_id/terminal-sessions        — lister les sessions actives
GET  /v1/vaults/:vault_id/terminal-sessions/:sid   — détail + session_key wrappée
POST /v1/vaults/:vault_id/terminal-sessions/:sid/join — demander à rejoindre
DELETE /v1/terminal-sessions/:sid                  — terminer une session

WS /v1/terminal-sessions/:sid/ws                   — connexion WebSocket
```

### Frontend

**Section "Team Sessions"** sur la homepage (en haut, avant la liste des connexions) :
- Cartes horizontales scrollables
- Chaque carte : nom de la connexion SSH, avatars des participants, durée
- Bouton "Rejoindre" si permission `JOIN_TERMINAL_SESSION`
- Badge "Live" animé

**Dans l'onglet terminal :**
- Barre "Team" en bas : avatars des participants connectés
- Indicateur "Contrôle : [Avatar]"
- Bouton "Demander le contrôle" (si quelqu'un d'autre écrit)
- Toast notification : "Jean demande le contrôle" → [Accorder] [Refuser]

**Modal "Démarrer une session partagée" :**
- Visibilité : Public / Membres spécifiques / Certains rôles / Privé
- Liste de participants pré-invités (optionnel)

### Notes de sécurité
- Un Guest ne peut que lire le terminal tant qu'il n'a pas le contrôle
- L'Host peut révoquer le contrôle à tout moment
- Les données sont chiffrées E2EE : le serveur relay ne voit que du bruit
- Sessions éphémères : aucun log du contenu terminal côté serveur
- Timeout inactivité configurable (défaut : 30 min)

### Future évolution : P2P WebRTC
- Signaling via le serveur (échange SDP/ICE)
- Connexion directe entre clients via WebRTC DataChannel
- Fallback automatique sur WebSocket relay si NAT/firewall bloque
- Avantage : latence réduite, serveur moins chargé

---

## Phase 8 — Connect-Only SSH Proxy (avancé)

> Permet au rôle Connect-Only de se connecter sans jamais avoir la clé en clair.

### Pourquoi c'est complexe

La clé SSH est chiffrée avec la VaultKey (Phase 2). Pour établir une vraie connexion
sans exposer la clé, il faut que **quelqu'un qui a la clé** fasse le proxy.
On ne peut pas stocker la clé sur le serveur sans briser l'E2EE.

### Solution : Ephemeral Proxy Token (délégation de session)

```
1. Un Owner/Editor ouvre son client (il a la VaultKey → peut déchiffrer les clés SSH)
2. Un Connect-Only user demande à se connecter à "Serveur X"
3. Le serveur notifie l'Owner (notification push / SSE)
4. L'Owner approve → son client déchiffre la clé SSH de "Serveur X"
5. Son client génère un token de session éphémère (UUID, valide 60s)
6. L'Owner établit la connexion SSH depuis son propre client (il est le proxy Rust)
7. Le Connect-Only user se connecte au WebSocket relay en lecture/écriture
8. Le trafic terminal passe : Connect-Only ↔ WebSocket relay ↔ Owner client ↔ SSH server
```

**Conséquence** : un Owner doit être en ligne pour qu'un Connect-Only puisse se connecter.
C'est une contrainte acceptable pour ce niveau de sécurité.

**Alternative simplifiée (Phase 8-lite)** : restriction UI uniquement (Connect-Only
ne voit pas les secrets dans l'interface), sans vrai proxy. Implémentable en 1h,
mais techniquement contournable par un utilisateur déterminé.

**Recommandation** : implémenter d'abord la Phase 8-lite (UI restriction, déjà prévu
dans le tableau des permissions COPY_SECRETS / VIEW_SECRETS de Phase 3), puis
implémenter le vrai proxy si le besoin sécuritaire est confirmé.

---

## Récapitulatif des dépendances

```
Phase 1 (Multi-user DB)
    └─> Phase 2 (Shared Vault Encryption)
            └─> Phase 3 (RBAC Built-in)
                    ├─> Phase 4 (Custom Roles)       ← parallélisable avec Phase 5
                    ├─> Phase 5 (Item-level Perms)   ← parallélisable avec Phase 4
                    ├─> Phase 6 (Audit Logging)      ← parallélisable avec 4 et 5
                    └─> Phase 7 (Multiplayer Terminal)
                                └─> Phase 8 (SSH Proxy) ← optionnel
```

---

## Stack technique — résumé des ajouts

| Composant | Ajout |
|---|---|
| PostgreSQL | 7 nouvelles tables (teams, team_members, invitations, shared_vaults, vault_member_keys, item_permissions, audit_logs) + 1 table session en mémoire (Redis ou in-process) |
| Axum (server/) | ~20 nouveaux endpoints REST + WebSocket handler |
| Rust (src-tauri/) | X25519 key exchange, VaultKey wrap/unwrap, SSH proxy (Phase 8) |
| TypeScript (frontend) | teamStore, permissionStore, sessionStore, hooks usePermission, useTeam, useSession |
| UI | Vault switcher, Settings > Team/Roles/Audit, Team Sessions section, terminal barre participante |

---

*Plan rédigé le 2026-04-07. Mis à jour le 2026-04-07 après livraison des phases 1, 2, 7.*
*1 Commit par phase, avec message de commit clair. No Co-Authored-By Claude.*
