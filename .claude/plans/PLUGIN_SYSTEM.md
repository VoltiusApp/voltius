# Plugin System — Plan d'architecture

> Stack : Tauri 2 + React 19 + TypeScript + Zustand  
> Principe fondamental : **zéro Rust requis pour les auteurs de plugins.**

---

## Table des matières

1. [Vision & philosophie](#1-vision--philosophie)
2. [Couches d'architecture](#2-couches-darchitecture)
3. [Manifest de plugin](#3-manifest-de-plugin)
4. [PluginAPI — Contrat TypeScript](#4-pluginapi--contrat-typescript)
5. [Points d'extension](#5-points-dextension)
6. [Système de permissions](#6-système-de-permissions)
7. [Lifecycle des plugins](#7-lifecycle-des-plugins)
8. [Mécanisme de chargement](#8-mécanisme-de-chargement)
9. [Stockage propre à un plugin](#9-stockage-propre-à-un-plugin)
10. [Bus d'événements inter-plugins](#10-bus-dévénements-inter-plugins)
11. [Frontière core / plugin](#11-frontière-core--plugin)
12. [Plugins par défaut](#12-plugins-par-défaut)
13. [Marketplace](#13-marketplace)
14. [Refactors prérequis](#14-refactors-prérequis)
15. [Roadmap phasée](#15-roadmap-phasée)

---

## 1. Vision & philosophie

Un plugin voltius est un **module TypeScript pur** qui reçoit une `PluginAPI` typée et s'enregistre via une fonction `register`. Il ne touche jamais à Rust.

Le système doit être assez puissant pour que :

- Le **moteur de sync** soit lui-même un plugin bundlé par défaut
- Les **thèmes** soient des plugins (ou du moins déclarables par des plugins)
- La détection auto des connexions **`.ssh/config`** soit un plugin

Ce qui est critique pour la performance (SSH I/O, rendu terminal, chiffrement) reste dans le **core Rust/Tauri** et n'est jamais exposable à un plugin.

---

## 2. Couches d'architecture

```text
┌──────────────────────────────────────────────────────┐
│  Plugin (TypeScript pur, npm package ou dossier local)│
│  export default function register(api: PluginAPI)    │
├──────────────────────────────────────────────────────┤
│  PluginAPI  (src/plugins/api.ts)                     │
│  Contrat typé, stable, versionné                     │
│  ↕ accès scopé aux stores Zustand existants          │
│  ↕ appels Tauri via wrappers whitelistés             │
├──────────────────────────────────────────────────────┤
│  Plugin Runtime  (src/plugins/runtime.ts)            │
│  Chargement, sandboxing léger, gestion permissions   │
├──────────────────────────────────────────────────────┤
│  Core Tauri/Rust  (src-tauri/)                       │
│  SSH, Vault (Stronghold), stockage config, terminal  │
│  Jamais appelé directement par un plugin             │
└──────────────────────────────────────────────────────┘
```

---

## 3. Manifest de plugin

Chaque plugin expose un fichier `plugin.json` à sa racine :

```json
{
  "id": "plugin-sync",
  "name": "Sync",
  "version": "1.0.0",
  "description": "Synchronise les connexions avec un backend distant.",
  "author": "voltius",
  "entry": "./dist/index.js",
  "permissions": [
    "connections:read",
    "connections:write",
    "vault:read",
    "vault:write",
    "http",
    "settings-page",
    "omni-commands"
  ],
  "defaultEnabled": true
}
```

### Champs

| Champ | Type | Description |
| ----- | ---- | ----------- |
| `id` | `string` | Identifiant unique, format `plugin-<nom>` |
| `entry` | `string` | Chemin vers le JS compilé |
| `permissions` | `string[]` | Capacités demandées (voir §6) |
| `defaultEnabled` | `boolean` | Actif sans action utilisateur (pour les plugins bundlés) |

---

## 4. PluginAPI — Contrat TypeScript

Fichier : `src/plugins/api.ts`

```typescript
// ─── Types exposés ─────────────────────────────────────────────────────────

export interface PluginConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  auth_type: "password" | "key";
  tags: string[];
}

export interface PluginConnectionInput {
  name: string;
  host: string;
  port: number;
  username: string;
  auth_type: "password" | "key";
  tags?: string[];
}

export interface OmniCommand {
  id: string;
  label: string;
  icon: string;                        // Iconify icon id
  keywords?: string[];                 // pour la recherche
  section?: string;                    // nom de section dans l'OmniSearch
  execute: () => void | Promise<void>;
}

export interface SettingsPage {
  id: string;
  label: string;
  icon: string;
  component: React.FC;
}

export interface SidebarItem {
  id: string;
  label: string;
  icon: string;
  component: React.FC;                 // contenu du panel principal
  position?: "top" | "bottom";        // défaut : "top"
}

export interface RightPanelSection {
  id: string;
  label: string;
  icon: string;
  component: React.FC;
}

export type ContextMenuTarget = "connection" | "session" | "tab";

export interface ContextMenuContext {
  connection?: PluginConnection;   // présent si target === "connection"
  sessionId?: string;              // présent si target === "session" | "tab"
}

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: string;
  target: ContextMenuTarget | ContextMenuTarget[];
  action: (ctx: ContextMenuContext) => void | Promise<void>;
}

export interface PluginTheme {
  id: string;
  name: string;
  fontFamily?: string;
  fontSize?: number;
  ui: UITheme;                         // réutilise UITheme de src/themes/types.ts
  terminal: TerminalTheme;             // réutilise TerminalTheme
}

// ─── API principale ────────────────────────────────────────────────────────

export interface PluginAPI {
  pluginId: string;

  // Connexions (requiert permissions connections:*)
  connections: {
    list(): Promise<PluginConnection[]>;
    get(id: string): Promise<PluginConnection | null>;
    create(data: PluginConnectionInput): Promise<PluginConnection>;
    update(id: string, data: Partial<PluginConnectionInput>): Promise<void>;
    delete(id: string): Promise<void>;
    bulkImport(items: PluginConnectionInput[]): Promise<PluginConnection[]>;
    /** S'abonner aux changements du store */
    subscribe(cb: (connections: PluginConnection[]) => void): () => void;
  };

  // Vault — secrets scopés au plugin (requiert vault:*)
  // Clé finale : `plugin:<pluginId>:<key>` — isolation garantie
  vault: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
  };

  // Thèmes (requiert permission "themes")
  themes: {
    register(theme: PluginTheme): void;
    unregister(id: string): void;
  };

  // OmniSearch (requiert "omni-commands")
  omni: {
    register(command: OmniCommand): void;
    unregister(id: string): void;
  };

  // UI — points d'extension (permissions spécifiques)
  ui: {
    registerSettingsPage(page: SettingsPage): void;                    // "settings-page"
    registerSidebarItem(item: SidebarItem): void;                      // "sidebar-item"
    registerRightPanelSection(section: RightPanelSection): void;       // "right-panel"
    registerContextMenuItem(item: ContextMenuItem): void;              // "context-menu"
    unregister(id: string): void;
  };

  // Stockage clé-valeur JSON propre au plugin (toujours disponible)
  storage: {
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<void>;
  };

  // HTTP (requiert "http")
  http: {
    get<T>(url: string, opts?: RequestInit): Promise<T>;
    post<T>(url: string, body: unknown, opts?: RequestInit): Promise<T>;
  };

  // Système de fichiers — restreint au home (requiert "fs")
  fs: {
    readText(path: string): Promise<string>;
    writeText(path: string, content: string): Promise<void>;
    exists(path: string): Promise<boolean>;
  };

  // Bus d'événements (toujours disponible)
  events: {
    on(event: string, handler: (data: unknown) => void): () => void;
    emit(event: string, data?: unknown): void;
  };

  // Logger scopé au plugin
  log: {
    info(msg: string, ...args: unknown[]): void;
    warn(msg: string, ...args: unknown[]): void;
    error(msg: string, ...args: unknown[]): void;
  };
}
```

---

## 5. Points d'extension

### 5.1 OmniSearch commands

Actuellement `OmniSearch.tsx` a un type `OmniItem` avec `kind: "action"`. Les plugins s'enregistrent via `api.omni.register()` et leurs commandes apparaissent dans une section dédiée.

Le runtime maintient un `Map<string, OmniCommand>` global injecté dans l'OmniSearch via un store léger (`pluginStore`).

```text
Hosts | Tabs | Quick connect | [Section plugin 1] | [Section plugin 2]
```

### 5.2 Settings page

`NavItem` dans `uiStore.ts` est aujourd'hui un union type fermé. Il devient extensible via le `pluginStore`. Les pages plugin apparaissent dans la sidebar sous les items natifs.

### 5.3 Sidebar items

Même mécanisme : les items plugin sont ajoutés dynamiquement sous les nav items natifs (`hosts`, `keychain`, etc.).

### 5.4 Right panel sections

`RightPanelSection` dans `uiStore.ts` est `"snippets" | "history" | "themes"`. Les plugins peuvent y ajouter des sections additionnelles.

### 5.5 Thèmes

Un plugin de thèmes appelle `api.themes.register(theme)` — le runtime l'injecte dans `themeStore.customThemes`. Le store existant n'a pas besoin d'être modifié en profondeur.

### 5.6 Menus contextuels

Un plugin enregistre des items via `api.ui.registerContextMenuItem()` en déclarant sur quelle(s) cible(s) ils apparaissent.

Le runtime maintient un `Map<string, ContextMenuItem>` dans `pluginStore`. Les composants concernés (`ConnectionCard`, `TerminalTabs`) lisent ce map et construisent leur menu contextuel à la demande — pas besoin de modifier leur logique métier, juste d'ajouter un rendu conditionnel.

```typescript
// Exemple dans plugin-sync
api.ui.registerContextMenuItem({
  id: "sync-single",
  label: "Sync this connection",
  icon: "lucide:refresh-cw",
  target: "connection",
  async action({ connection }) {
    await pushToRemote(api, connection!);
  },
});

// Exemple dans plugin-ssh-config
api.ui.registerContextMenuItem({
  id: "edit-in-ssh-config",
  label: "Edit in ~/.ssh/config",
  icon: "lucide:file-edit",
  target: "connection",
  async action({ connection }) {
    await openInSshConfig(api, connection!.host);
  },
});
```

**Implémentation côté composant** — `ConnectionCard.tsx` expose un menu contextuel minimal :

```tsx
const pluginItems = usePluginStore(s =>
  [...s.contextMenuItems.values()].filter(i =>
    [i.target].flat().includes("connection")
  )
);

// dans le JSX : menu contextuel conditionnel si pluginItems.length > 0
```

### 5.7 Connection providers (futur)

Pour des cas comme AWS SSM ou Kubernetes, un plugin pourrait exposer une `ConnectionSource` qui alimente la liste de hosts de manière dynamique (read-only, non persisté). À définir en phase 2.

---

## 6. Système de permissions

Les permissions sont déclarées dans `plugin.json` et vérifiées à l'exécution par le runtime avant de créer l'API. Si une permission manque, l'appel throw une erreur explicite.

| Permission | Donne accès à |
| ---------- | ------------- |
| `connections:read` | `api.connections.list()`, `.get()`, `.subscribe()` |
| `connections:write` | `api.connections.create()`, `.update()`, `.delete()`, `.bulkImport()` |
| `vault:read` | `api.vault.get()` |
| `vault:write` | `api.vault.set()`, `.delete()` |
| `http` | `api.http.*` |
| `fs` | `api.fs.*` (restreint au répertoire home de l'OS) |
| `themes` | `api.themes.register()` |
| `omni-commands` | `api.omni.register()` |
| `settings-page` | `api.ui.registerSettingsPage()` |
| `sidebar-item` | `api.ui.registerSidebarItem()` |
| `right-panel` | `api.ui.registerRightPanelSection()` |
| `context-menu` | `api.ui.registerContextMenuItem()` |

> `api.storage`, `api.events`, `api.log` sont toujours disponibles sans permission.

Les permissions `vault:*` sont les seules à potentiellement déclencher un consentement utilisateur explicite (modale) lors du premier accès.

---

## 7. Lifecycle des plugins

### Enabled vs disabled

L'état activé/désactivé de chaque plugin est persisté dans `~/.config/voltius/plugin-registry.json`. Le runtime lit cet état au démarrage et skip `plugin.register(api)` pour les plugins désactivés.

**Plugins bundlés** (livrés dans le binaire de l'app) : peuvent être **désactivés** mais pas désinstallés. L'UI affiche un toggle. Le désactiver est l'équivalent pratique d'une désinstallation.

**Plugins utilisateur** (installés dans `~/.config/voltius/plugins/`) : peuvent être **désactivés** ou **désinstallés** (le dossier est supprimé). L'UI affiche toggle + bouton désinstaller.

```text
App start
  │
  ├─► PluginRuntime.loadAll()
  │     ├─ lit plugin-registry.json (états enabled)
  │     ├─ lit plugins/ (bundlés) + ~/.config/voltius/plugins/ (utilisateur)
  │     ├─ valide manifest
  │     ├─ skip si enabled === false
  │     ├─ crée PluginAPI scopée (permissions filtrées)
  │     └─ appelle plugin.register(api)
  │           └─ le plugin s'enregistre (omni, ui, themes...)
  │
  ├─► App render
  │     └─ pluginStore alimente OmniSearch, Sidebar, etc.
  │
  └─► App teardown
        └─ PluginRuntime.unloadAll()
              └─ nettoie les subscriptions, désenregistre les items UI
```

Chaque plugin reçoit une **fonction de cleanup** optionnelle :

```typescript
export default function register(api: PluginAPI): (() => void) | void {
  const unsub = api.connections.subscribe(handleChange);
  const removeCmd = api.omni.register({ id: "my-cmd", ... });
  
  return () => {    // appelé au teardown ou si le plugin est désactivé
    unsub();
    removeCmd();
  };
}
```

---

## 8. Mécanisme de chargement

Les plugins bundlés (livrés avec l'app) sont importés **statiquement** au build pour éviter tout overhead :

```typescript
// src/plugins/bundled.ts
import syncPlugin from "@voltius/plugin-sync";
import sshConfigPlugin from "@voltius/plugin-ssh-config";
import themesPlugin from "@voltius/plugin-themes";

export const BUNDLED_PLUGINS = [syncPlugin, sshConfigPlugin, themesPlugin];
```

Les plugins utilisateur (installés par l'utilisateur) sont chargés via **dynamic import** au démarrage :

```typescript
// src/plugins/runtime.ts
async function loadUserPlugin(manifestPath: string) {
  const manifest = await loadManifest(manifestPath);
  const mod = await import(/* @vite-ignore */ manifest.entry);
  const api = createPluginAPI(manifest);
  const cleanup = mod.default(api);
  registry.set(manifest.id, { manifest, cleanup });
}
```

**Distribution** : les plugins utilisateur sont des dossiers dans `~/.config/voltius/plugins/<plugin-id>/` contenant `plugin.json` + le JS compilé. À terme, un registry public (similaire à npm ou l'index d'Obsidian) peut être envisagé.

---

## 9. Stockage propre à un plugin

`api.storage` est un store clé-valeur JSON persisté dans `~/.config/voltius/plugin-data/<plugin-id>.json` via Tauri `fs`. Totalement isolé entre plugins.

```typescript
// Exemple dans plugin-sync
await api.storage.set("lastSync", new Date().toISOString());
const last = await api.storage.get<string>("lastSync");
```

---

## 10. Bus d'événements inter-plugins

`api.events` est un EventEmitter partagé entre tous les plugins via le runtime. Les événements sont préfixés par `pluginId` pour éviter les collisions :

```typescript
// plugin-sync émet
api.events.emit("sync:completed", { count: 12 });

// plugin-notifier écoute
api.events.on("plugin-sync:sync:completed", (data) => {
  console.log(`Synced ${data.count} connections`);
});
```

Le runtime préfixe automatiquement `emit` avec `<pluginId>:`, mais `on` accepte n'importe quel chemin pour permettre l'écoute cross-plugin.

---

## 11. Frontière core / plugin

### Règle fondamentale

> **Un plugin ne peut jamais accéder à une session SSH active, lire/écrire dans un canal SSH, créer un tunnel, ou exécuter une commande sur un hôte distant.**
>
> Toute feature qui nécessite l'une de ces capacités est implémentée dans le core Rust et n'est pas pluggable. La `PluginAPI` ne contient délibérément aucune surface `api.ssh`, `api.session`, ou `api.terminal`.

### Ce qui reste dans le core (intouchable par les plugins)

| Composant | Raison |
| --------- | ------ |
| SSH protocol (russh) | Performance, sécurité |
| Sessions SSH actives | Sécurité — accès session = tunnel arbitraire possible |
| Port forwarding | Requiert `direct-tcpip` sur session SSH (voir [PORT_FORWARDING.md](PORT_FORWARDING.md)) |
| Snippets | Injection dans canal SSH — commande arbitraire possible si pluggable |
| Known hosts | Sécurité critique — protège contre les attaques MITM |
| Stronghold vault | Sécurité, intégrité |
| Terminal I/O + rendu WebGL | Latence critique, boucle temps réel |
| Session multiplexing | Concurrence Rust/Tokio |
| Fenêtre Tauri, TitleBar | Intégration OS |

### Ce que les plugins peuvent faire

- Lire et écrire les connexions (métadonnées uniquement — pas les credentials)
- Lire/écrire des secrets dans leur espace vault **scopé** (`plugin:<id>:*`)
- Ajouter des pages, panels, commandes dans l'UI
- Enregistrer des thèmes
- Faire des appels HTTP externes
- Lire/écrire des fichiers dans le répertoire home (permission `fs`)
- Communiquer avec d'autres plugins via l'event bus
- Déclencher des exports/imports de backup via `api.backup` (opaque — le plugin ne voit pas les secrets)

### Ce que les plugins ne peuvent jamais faire

- Accéder à une session SSH active ou à son output
- Écrire dans un canal terminal (injection de commandes)
- Créer des tunnels SSH (`direct-tcpip`)
- Accéder aux secrets vault d'un autre plugin ou du core
- Appeler `ssh_send_input` ou tout équivalent — cette commande Tauri n'est pas dans `PluginAPI`
- Contourner le système de permissions via des appels Tauri directs

---

## 12. Plugins par défaut

Ces plugins sont bundlés dans l'app et activés par défaut. Leur code vit dans `packages/` à la racine du monorepo (structure future).

### Règle d'exclusivité sync

**Un seul plugin sync peut être actif à la fois.** Activer un plugin sync désactive automatiquement l'autre. Sur le switch, le blob actuel est exporté vers le nouveau backend avant que l'ancien soit désactivé — aucune perte de données.

Cette règle est enforced par le runtime : les plugins sync se déclarent avec `"syncPlugin": true` dans leur manifest. Le runtime vérifie qu'au plus un est enabled dans `plugin-registry.json`.

---

### `plugin-sync`

**Rôle** : synchronise l'intégralité du profil utilisateur vers le serveur first-party E2EE (ou self-hosted). Actif par défaut si l'utilisateur a choisi le mode serveur.

**Permissions** : `backup`, `http`, `settings-page`, `omni-commands`

> `backup` autorise uniquement `api.backup.export/import` — le plugin ne voit jamais de credential en clair. Tout le chiffrement est délégué au core Rust avec l'`encryption_key` dérivé du master password (voir [CORE.md §2](CORE.md)).

---

#### Ce qui est synchronisé

| Catégorie | Contenu | Stockage source |
| --------- | ------- | --------------- |
| Connexions | Métadonnées (host, port, user, tags...) | `connections.json` (Rust) |
| Credentials | Mots de passe SSH, clés privées | Stronghold vault (Rust) |
| Paramètres app | Thème actif, thèmes custom, raccourcis clavier | `localStorage` (Zustand persist) |
| Plugins installés | Liste + manifests des plugins utilisateur | `~/.config/voltius/plugins/` |
| Données plugins | Storage JSON de chaque plugin | `plugin-data/<id>.json` (Rust) |
| Secrets plugins | Secrets vault propres à chaque plugin | Stronghold, préfixe `plugin:<id>:` |

> **Ce qui n'est pas synchronisé** : sessions actives, cache de distro icons, état UI transitoire.

---

#### Modèle de sécurité : E2EE, le serveur ne voit rien

Le chiffrement est entièrement géré côté Rust avec l'`encryption_key` dérivé du master password. Le plugin-sync ne fait que transporter des blobs opaques.

```text
EXPORT (auto ou "Sync now")
  plugin-sync
    → appSettings = gatherAppSettings()   ← lit les stores Zustand
    → api.backup.export(appSettings, opts)
        → invoke Rust: backup_export(settings_json, opts)
            ├─ lit connections.json
            ├─ lit tous les secrets Stronghold
            ├─ lit plugin-data/*.json
            ├─ reçoit appSettings depuis TS
            ├─ sérialise en SyncBundle
            └─ chiffre avec ChaCha20-Poly1305 + encryption_key
        → retourne: { header: SyncMetadata, blob: base64 }
    → PUT /sync/blob { blob }   ← serveur stocke un blob qu'il ne peut pas lire

IMPORT (login sur nouveau device — déclenché par le core, pas le plugin)
  core (AccountGuard)
    → GET /sync/blob → blob chiffré
    → api.backup.import(blob)
        → invoke Rust: backup_import(blob)
            ├─ déchiffre avec encryption_key (déjà dérivé du master password)
            ├─ restaure connections.json
            ├─ restaure secrets Stronghold
            └─ restaure plugin-data/*.json
        → retourne { appSettings, installedPlugins }

  Ordre de restore (important — voir note ci-dessous) :
    1. appSettings appliqués aux stores Zustand
         → customThemes disponibles immédiatement (pas de réseau)
         → activeThemeId connu mais pas encore appliqué si c'est un plugin
    2. Re-téléchargement des plugins manquants (installedPlugins diff avec plugins locaux)
         → fetch depuis leur source d'origine (stockée dans le manifest)
         → si un plugin est indisponible : loggé, ignoré, pas bloquant
    3. PluginRuntime.loadAll() — charge et exécute les plugins restaurés
         → les plugins de thèmes appellent api.themes.register()
    4. activeThemeId appliqué
         → le thème est maintenant disponible (étape 3 garantie avant étape 4)
         → si toujours introuvable (plugin indisponible) : fallback thème built-in par défaut
```

> **Pourquoi cet ordre ?** `activeThemeId` peut pointer vers un thème de plugin marketplace. Si on applique le thème avant que les plugins soient chargés, l'app tombe en fallback silencieux. L'étape 4 doit être la dernière pour garantir que tous les thèmes sont enregistrés au moment de l'application.

---

#### SyncBundle (interne Rust, jamais exposé au plugin)

```rust
struct SyncBundle {
    version: u32,
    exported_at: String,
    device_id: String,
    includes: Vec<String>,
    connections: Vec<Connection>,
    vault_secrets: HashMap<String, String>,
    plugin_vault: HashMap<String, HashMap<String, String>>,
    app_settings: AppSettingsJson,
    plugin_storage: HashMap<String, Value>,
    installed_plugins: Vec<PluginManifest>,
}
```

Le blob final = `[metadata_json_unencrypted | separator | chacha20_ciphertext]`.
Le header non chiffré permet d'afficher "Dernier sync il y a 2h depuis MacBook Pro" sans avoir à déchiffrer.

---

#### Granularité : scopes de sync

Configurable dans la page settings du plugin :

```typescript
interface SyncScope {
  connections: boolean;   // métadonnées connexions
  credentials: boolean;   // mots de passe + clés
  appSettings: boolean;   // thème, raccourcis
  plugins: boolean;       // plugins installés + leurs données
}
```

Tous activés par défaut. `credentials: false` utile pour exclure les secrets d'un device partagé.

---

#### Backends

| Backend | Par défaut | Notes |
| ------- | ---------- | ----- |
| Serveur first-party | Oui | Compte créé à l'inscription, E2EE, zéro config |
| Serveur self-hosted | Non | URL configurable dans les settings (pour power users) |
| Fichier local | Non | Export/import manuel |

L'interface `SyncBackend` permet d'ajouter d'autres backends via des plugins tiers :

```typescript
interface SyncBackend {
  id: string;
  name: string;
  upload(blob: string, jwt: string): Promise<void>;
  download(jwt: string): Promise<string | null>;
  getLastModified(jwt: string): Promise<Date | null>;
}
```

---

#### Résolution de conflits

Stratégie : **last-write-wins** basé sur `exported_at` dans le header non chiffré.

Si le blob distant est plus récent que le dernier export local → import automatique silencieux.
Si le blob local est plus récent → export automatique silencieux.
Conflit détecté (éditions simultanées) → l'utilisateur choisit dans les settings.

---

#### Code du plugin (squelette)

```typescript
// packages/plugin-sync/src/index.ts
export default function register(api: PluginAPI) {

  api.ui.registerSettingsPage({
    id: "sync-settings",
    label: "Sync",
    icon: "lucide:refresh-cw",
    component: () => <SyncSettingsPage api={api} />,
  });

  api.omni.register({
    id: "sync-now",
    label: "Sync now",
    icon: "lucide:refresh-cw",
    section: "Sync",
    async execute() {
      const appSettings = gatherAppSettings();
      const { blob } = await api.backup.export(appSettings);
      const jwt = await api.vault.get("jwt");
      await defaultBackend.upload(blob, jwt!);
      await api.storage.set("lastSync", new Date().toISOString());
      api.events.emit("sync:completed");
    },
  });

  // Sync automatique toutes les 5 minutes si connecté
  startAutoSync(api);
}
```

---

### `plugin-ssh-config`

**Rôle** : importe les hôtes depuis `~/.ssh/config`.

**Permissions** : `connections:write`, `fs`, `omni-commands`, `settings-page`

**Ce qu'il fait** :

- Commande OmniSearch "Import ~/.ssh/config"
- Parse le fichier SSH config (parser JS pur, ex: `ssh-config` npm package)
- Déduplique par host avant import
- Page de settings pour configurer le chemin (si non-standard)

```typescript
export default function register(api: PluginAPI) {
  api.omni.register({
    id: "import-ssh-config",
    label: "Import ~/.ssh/config",
    icon: "lucide:file-input",
    section: "Import",
    async execute() {
      const raw = await api.fs.readText("~/.ssh/config");
      const hosts = parseSshConfig(raw);  // lib npm
      const existing = await api.connections.list();
      const toImport = hosts.filter(
        (h) => !existing.some((e) => e.host === h.host && e.username === h.username)
      );
      await api.connections.bulkImport(toImport);
    },
  });
}
```

---

---

### `plugin-gist-sync`

**Rôle** : synchronise l'intégralité du profil utilisateur via un Gist GitHub privé. Alternative au serveur — aucun serveur à héberger, aucun compte à créer au-delà d'un GitHub PAT. Mutuellement exclusif avec `plugin-sync` (voir règle d'exclusivité ci-dessus).

**Permissions** : `backup`, `http`, `vault:read`, `vault:write`, `settings-page`, `omni-commands`

**Configuration** : GitHub Personal Access Token (scope `gist`) saisi dans la page settings. Le Gist ID est créé automatiquement au premier export et stocké dans `api.storage`.

**Format du Gist** :

```text
Gist privé (1 fichier : voltius-sync.bin)
  ├─ Header JSON non chiffré : { account_id, exported_at, device_id, version }
  └─ Blob chiffré opaque (ChaCha20-Poly1305, même format que plugin-sync)
```

`account_id` dans le header permet à un nouveau device de dériver l'`account_enc_key` sans avoir à mémoriser l'UUID séparément (voir [CORE.md §1](CORE.md)).

**Multi-device via Gist** : sur un nouveau device, l'utilisateur saisit son PAT + le Gist ID (ou le scanne via QR) + son master password. Le client télécharge le Gist, lit l'`account_id` dans le header, dérive l'`account_enc_key`, déchiffre le blob.

```typescript
// packages/plugin-gist-sync/src/index.ts
export default function register(api: PluginAPI) {

  api.ui.registerSettingsPage({
    id: "gist-sync-settings",
    label: "Gist Sync",
    icon: "lucide:github",
    component: () => <GistSyncSettingsPage api={api} />,
  });

  api.omni.register({
    id: "gist-sync-now",
    label: "Sync now (Gist)",
    icon: "lucide:refresh-cw",
    section: "Sync",
    async execute() {
      const pat = await api.vault.get("github_pat");
      if (!pat) return;
      const { blob } = await api.backup.export(gatherAppSettings());
      await uploadToGist(pat, blob, api);
      await api.storage.set("lastSync", new Date().toISOString());
    },
  });

  startAutoSync(api);
}
```

---

### Plugins envisagés (phase ultérieure)

| Plugin | Permissions clés | Description |
| ------ | ---------------- | ----------- |
| `plugin-aws-ssm` | `connections:write`, `http`, `vault:*` | Import des instances EC2 via AWS SDK |

> **`plugin-known-hosts`, `plugin-port-forward` et `plugin-snippets` ont été retirés de cette liste.**
>
> - Known hosts : sécurité MITM → core
> - Port forwarding : requiert `direct-tcpip` sur session SSH → core (voir [PORT_FORWARDING.md](PORT_FORWARDING.md))
> - Snippets : l'injection dans un canal SSH actif ne peut pas être exposée dans `PluginAPI` — un plugin malveillant pourrait exécuter des commandes arbitraires sur les serveurs de l'utilisateur → core

---

## 13. Marketplace

Le marketplace est **indépendant du mode de sync**. Un utilisateur local-only peut installer des plugins — la découverte et l'installation ne requièrent qu'un accès internet, pas de compte.

Les thèmes communautaires sont des plugins comme les autres (ils appellent `api.themes.register()`). Le marketplace est un système unifié — pas de catalogue séparé pour les thèmes. Les thèmes built-in (`src/themes/presets.ts`) restent dans le core et ne passent pas par le marketplace.

---

### Sources

L'utilisateur configure une liste de sources dans les settings. L'app fetch toutes les sources en parallèle et merge les résultats.

```text
Sources (ordre dans les settings) :
  1. https://github.com/voltius/marketplace   ← pré-configurée, non supprimable, désactivable
  2. https://github.com/acme/voltius-plugins  ← source custom ajoutée par l'user
  3. https://gitea.internal/org/private-plugins  ← registre privé d'entreprise
```

Chaque source est une URL pointant vers un `plugins.json` (format identique quelle que soit la source). La recherche s'effectue sur l'ensemble des sources **actives** simultanément — les résultats indiquent leur provenance. La source first-party peut être désactivée (aucune requête émise vers elle) mais pas supprimée — elle reste disponible si l'utilisateur veut la réactiver.

---

### Format de l'index (`plugins.json`)

```json
[
  {
    "id": "plugin-aws-ssm",
    "name": "AWS SSM",
    "author": "acme",
    "description": "Import EC2 instances via AWS SSM.",
    "repo": "acme/voltius-plugin-aws-ssm",
    "version": "1.2.0",
    "minAppVersion": "0.1.0",
    "tags": ["aws", "import", "cloud"],
    "theme": false
  },
  {
    "id": "theme-catppuccin",
    "name": "Catppuccin",
    "author": "catppuccin",
    "description": "Soothing pastel theme.",
    "repo": "catppuccin/voltius-theme",
    "version": "2.0.0",
    "minAppVersion": "0.1.0",
    "tags": ["theme", "dark"],
    "theme": true
  }
]
```

`repo` est un chemin GitHub (`owner/repo`). L'app fetch le dernier release asset (`plugin.js`) depuis l'API GitHub Releases. Pour les sources non-GitHub, `repo` peut être une URL directe vers le bundle.

---

### Modes d'installation

| Mode | Description | Avertissement |
| ---- | ----------- | ------------- |
| Depuis le marketplace | Plugin listé dans un index connu | Aucun |
| URL directe | L'user colle une URL vers un `.js` | "Plugin non vérifié" |
| Dossier local | `~/.config/voltius/plugins/<id>/` | Pour le développement |

---

### Repo first-party (`voltius/marketplace`)

Structure du repo GitHub :

```text
voltius/marketplace
├── plugins.json          ← index principal
├── CONTRIBUTING.md       ← guide pour soumettre un plugin
└── schemas/
    └── plugin.schema.json
```

Contribuer un plugin = ouvrir une PR qui ajoute une entrée dans `plugins.json`. Pas d'infrastructure serveur à maintenir — GitHub héberge l'index, les auteurs hébergent leurs releases.

---

## 14. Refactors prérequis

Ces changements au code existant sont nécessaires avant d'implémenter le système.

### 13.1 `pluginStore` — nouveau store Zustand

`src/stores/pluginStore.ts` — maintient les registres dynamiques que les composants consomment.

```typescript
interface PluginStore {
  omniCommands: Map<string, OmniCommand>;
  settingsPages: Map<string, SettingsPage>;
  sidebarItems: Map<string, SidebarItem>;
  rightPanelSections: Map<string, RightPanelSection>;
  pluginThemes: Map<string, PluginTheme>;

  registerOmniCommand(cmd: OmniCommand): void;
  unregisterOmniCommand(id: string): void;
  // ... idem pour les autres
}
```

### 13.2 `OmniSearch.tsx`

- Lire `pluginStore.omniCommands` et les ajouter aux `items`
- Grouper par `command.section`

### 13.3 `uiStore.ts`

- `NavItem` : passer d'un union type fermé à `string` pour supporter les items dynamiques
- `RightPanelSection` : idem

### 13.4 `themeStore.ts`

- `getActiveTheme` : chercher aussi dans `pluginStore.pluginThemes`

### 13.5 `Sidebar.tsx`

- Lire `pluginStore.sidebarItems` et les rendre après les items natifs

### 13.6 `ConnectionCard.tsx` et `TerminalTabs.tsx`

- Lire `pluginStore.contextMenuItems` filtré par `target`
- Rendre un menu contextuel (clic droit ou bouton `⋯`) uniquement si des items plugin existent — aucun changement visuel sans plugin installé

### 13.7 `vault.ts` (service)

- Ajouter `storePluginSecret(pluginId, key, value)` et `getPluginSecret(pluginId, key)` qui préfixent la clé avec `plugin:<pluginId>:`

---

## 15. Roadmap phasée

### Phase 1 — Infrastructure (fondations, pas de plugin visible par l'utilisateur)

- [x] Créer `src/plugins/api.ts` — interface `PluginAPI` complète
- [x] Créer `src/plugins/runtime.ts` — `createPluginAPI()`, `loadPlugin()`, `PluginRegistry`
- [x] Créer `src/stores/pluginStore.ts`
- [x] Adapter `OmniSearch.tsx` pour consommer `pluginStore.omniCommands`
- [x] Adapter `themeStore.ts` pour inclure les thèmes plugin
- [x] Adapter `vault.ts` pour les secrets scopés
- [ ] Tester le runtime avec un plugin mock interne

### Phase 2 — Plugins par défaut

- [x] Implémenter `plugin-ssh-config` (le plus simple, valide `fs` + `omni`)
- [ ] Implémenter `plugin-sync` (valide `vault` + `http` + `settings-page`)
- [ ] Implémenter `plugin-gist-sync` (alternative sans serveur, valide `backup` + `http`)
- [ ] Implémenter la règle d'exclusivité sync dans le runtime (`syncPlugin: true` + vérification au enable)
- [x] UI de gestion des plugins : toggle enable/disable, bouton désinstaller pour plugins utilisateur (`src/components/settings/SettingsModal.tsx` — section Plugins)
- [x] Créer `src/stores/pluginRegistryStore.ts` — état enabled/disabled persisté localStorage
- [ ] Adapter `Sidebar.tsx` pour les items dynamiques
- [ ] Adapter `RightPanel.tsx` pour les sections dynamiques
- [x] Inclure `plugin-data/` et `plugin-registry` dans `backup_export` (Rust) pour la sync — `plugin-registry.json` via nouvelles commandes Tauri `plugin_registry_load/save`, `plugin-data/` via lecture récursive dans `backup_export`

### Phase 3 — Plugins utilisateur & marketplace

- [ ] Chargement dynamique depuis `~/.config/voltius/plugins/`
- [ ] UI marketplace : parcourir, rechercher, installer depuis l'index first-party
- [ ] Support multi-sources : ajout/suppression de sources dans les settings
- [ ] Fetch `plugins.json` de toutes les sources en parallèle, merge des résultats
- [ ] Installation depuis URL directe (avec avertissement "plugin non vérifié")
- [ ] UI de gestion des plugins (activer/désactiver, voir permissions, désinstaller)
- [ ] Documentation pour les auteurs de plugins + `CONTRIBUTING.md` sur le repo marketplace
- [ ] Créer le repo `voltius/marketplace` avec `plugins.json` initial
