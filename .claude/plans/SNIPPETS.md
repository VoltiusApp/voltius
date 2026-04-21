# Snippets — Plan d'architecture

> Feature **core** — l'injection dans un canal SSH actif ne peut pas être pluggable (voir [PLUGIN_SYSTEM.md §11](PLUGIN_SYSTEM.md)).  
> UI et stockage intégrés au core. Synchronisés via le système de backup.

---

## Table des matières

1. [Vision](#1-vision)
2. [Modèle de données](#2-modèle-de-données)
3. [Système de variables](#3-système-de-variables)
4. [Flux d'injection](#4-flux-dinjection)
5. [Architecture Rust](#5-architecture-rust)
6. [UI](#6-ui)
7. [Ce qui dépasse Termius](#7-ce-qui-dépasse-termius)
8. [Roadmap](#8-roadmap)

---

## 1. Vision

Les snippets sont des **templates de commandes** réutilisables, injectés directement dans le terminal SSH actif. Ils supportent des variables typées avec résolution interactive, une organisation en dossiers, des filtres contextuels par connexion, et deux modes d'injection (exécution immédiate ou insertion pour révision).

Référence : Termius snippets — avec un système de variables plus riche et une meilleure intégration contextuelle.

---

## 2. Modèle de données

Stocké dans `~/.config/voltius/snippets.json` et inclus dans le backup de sync.

```typescript
interface Snippet {
  id: string;
  name: string;
  content: string;          // template brut avec {{variables}}
  description?: string;
  tags: string[];
  folderId?: string;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;

  // Filtres contextuels (optionnels)
  onlyForConnectionTags?: string[];   // ex: ["prod", "k8s"]
  onlyForDistros?: string[];          // ex: ["ubuntu", "debian"]
}

interface SnippetFolder {
  id: string;
  name: string;
  parentId?: string;   // null = racine
  color?: string;      // couleur d'accentuation dans l'UI
  icon?: string;       // Iconify icon id
}

interface SnippetsStore {
  snippets: Snippet[];
  folders: SnippetFolder[];
}
```

---

## 3. Système de variables

### Syntaxe générale

```
{{nom}}
{{nom:type}}
{{nom:type:défaut}}
{{nom:type:défaut:label affiché}}
```

### Types disponibles

| Type | Syntaxe | UI générée | Exemple |
| ---- | ------- | ---------- | ------- |
| `text` (défaut) | `{{var}}` | Input texte | `{{branch}}` |
| `number` | `{{var:number:8080}}` | Input numérique | `{{port:number:8080}}` |
| `password` | `{{var:password}}` | Input masqué | `{{sudo_pass:password}}` |
| `boolean` | `{{var:boolean:true}}` | Toggle on/off | `{{verbose:boolean:false}}` |
| `choice` | `{{var:choice:a,b,c}}` | Dropdown | `{{env:choice:dev,staging,prod}}` |

### Variables dynamiques (auto-remplies, aucun prompt)

| Variable | Valeur injectée |
| -------- | --------------- |
| `{{connection.host}}` | Hostname de la connexion active |
| `{{connection.username}}` | Utilisateur SSH de la connexion active |
| `{{connection.name}}` | Nom affiché de la connexion |
| `{{date}}` | Date locale `YYYY-MM-DD` |
| `{{datetime}}` | Date + heure locale `YYYY-MM-DD HH:mm:ss` |
| `{{timestamp}}` | Unix timestamp en secondes |
| `{{clipboard}}` | Contenu actuel du presse-papier |

### Exemples de templates

```bash
# Déploiement avec choix d'environnement
git push origin {{branch:text:main}} && ssh {{connection.host}} "cd /app && git pull && ./deploy.sh {{env:choice:dev,staging,prod}}"

# Tunnel DB temporaire (port forwarding manuel via snippet)
ssh -L {{local_port:number:5433}}:localhost:5432 {{connection.username}}@{{connection.host}} -N &

# Backup rapide avec timestamp
tar czf /tmp/backup-{{datetime}}.tar.gz {{path:text:/var/www}}

# sudo avec mot de passe (masqué)
echo '{{sudo_pass:password}}' | sudo -S {{command:text:apt update}}
```

### Parsing des variables

```typescript
// src/services/snippets.ts

interface ParsedVariable {
  name: string;
  type: "text" | "number" | "password" | "boolean" | "choice";
  default?: string;
  label?: string;
  choices?: string[];
  dynamic: boolean;   // true = auto-remplie, pas de prompt
}

function parseVariables(template: string): ParsedVariable[] {
  const regex = /\{\{([^}]+)\}\}/g;
  const seen = new Set<string>();
  const vars: ParsedVariable[] = [];

  for (const match of template.matchAll(regex)) {
    const parts = match[1].split(":");
    const name = parts[0].trim();

    if (seen.has(name)) continue;  // dédupliquer
    seen.add(name);

    const isDynamic = DYNAMIC_VARS.has(name);  // connection.host, date, etc.
    if (isDynamic) {
      vars.push({ name, type: "text", dynamic: true });
      continue;
    }

    const type = (parts[1] as ParsedVariable["type"]) ?? "text";
    const def = parts[2];
    const label = parts[3];
    const choices = type === "choice" ? def?.split(",") : undefined;

    vars.push({ name, type, default: def, label, choices, dynamic: false });
  }

  return vars;
}
```

---

## 4. Flux d'injection

```text
Utilisateur clique sur un snippet
  │
  ├─ parseVariables(snippet.content)
  │
  ├─ résolution des variables dynamiques
  │    connection.host → activeSession.connectionHost
  │    date → new Date().toISOString().split("T")[0]
  │    clipboard → navigator.clipboard.readText()
  │    etc.
  │
  ├─ variables utilisateur restantes ?
  │    ├─ Oui → modale "Fill in variables"
  │    │         inputs typés par variable
  │    │         preview du résultat en temps réel
  │    │         [Insert]  [Execute]  [Cancel]
  │    │
  │    └─ Non → directement à l'injection
  │
  ├─ résolution finale du template
  │    template.replace(/\{\{nom\}\}/g, resolvedValues["nom"])
  │
  └─ invoke("snippet_inject", { sessionId, text, execute })
       ├─ execute: true  → texte + "\n" (lance la commande)
       └─ execute: false → texte seul  (l'utilisateur peut éditer avant Enter)
```

### Modale de résolution

```
╔══════════════════════════════════════╗
║  Deploy to environment               ║
║  ──────────────────────────────────  ║
║  Branch        [main          ]      ║
║  Environment   [staging    ▼  ]      ║
║  ──────────────────────────────────  ║
║  Preview:                            ║
║  git push origin main && ssh ...     ║
║  deploy.sh staging                   ║
║  ──────────────────────────────────  ║
║          [Insert]    [Execute]       ║
╚══════════════════════════════════════╝
```

Le preview se met à jour en temps réel pendant la saisie.

---

## 5. Architecture Rust

### Commande d'injection

```rust
// src-tauri/src/commands/snippets.rs

#[tauri::command]
pub async fn snippet_inject(
    session_id: String,
    text: String,
    execute: bool,
    state: State<'_, SessionManager>,
) -> Result<(), String> {
    let sessions = state.sessions.lock().await;
    let session = sessions.get(&session_id)
        .ok_or("Session not found")?;

    let payload = if execute {
        format!("{text}\n")
    } else {
        text
    };

    session.send_input(payload.into_bytes())
        .await
        .map_err(|e| e.to_string())
}
```

`snippet_inject` est une commande Tauri **dédiée et intentionnellement distincte** de `ssh_send_input`. Elle n'est pas exposée dans `PluginAPI`. Seul le code core peut l'appeler.

### Stockage

```rust
// src-tauri/src/commands/snippets.rs

#[tauri::command]
pub fn snippets_load() -> Result<SnippetsStore, String> {
    let path = config_dir().join("snippets.json");
    if !path.exists() {
        return Ok(SnippetsStore::default());
    }
    let data = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&data).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn snippets_save(store: SnippetsStore) -> Result<(), String> {
    let path = config_dir().join("snippets.json");
    let data = serde_json::to_string_pretty(&store).map_err(|e| e.to_string())?;
    fs::write(path, data).map_err(|e| e.to_string())
}
```

---

## 6. UI

### Emplacement

Section native `"snippets"` dans le `RightPanel` — déjà présente dans `uiStore.ts` comme `RightPanelSection`. Elle devient fonctionnelle au lieu de placeholder.

### SnippetsPanel

```
┌─────────────────────────────────────┐
│ 🔍 Search snippets...          [+]  │
├─────────────────────────────────────┤
│ ▼ 📁 Deployment                     │
│   ⚡ Deploy to env          [▶] [⋯] │
│   ⚡ Rollback               [▶] [⋯] │
│ ▶ 📁 Database                       │
│ ▼ 📁 Monitoring                     │
│   ⚡ Check disk usage       [▶] [⋯] │
│   ⭐ Top processes          [▶] [⋯] │
├─────────────────────────────────────┤
│ Recent                              │
│   Deploy to env · 2m ago            │
│   Check disk usage · 1h ago         │
└─────────────────────────────────────┘
```

- `[▶]` → injection (ouvre la modale si variables, injecte directement sinon)
- `[⋯]` → menu contextuel : Edit, Duplicate, Move to folder, Delete
- `[+]` → créer un snippet ou dossier
- Glisser-déposer pour réorganiser

### Intégration OmniSearch

Les snippets apparaissent dans l'OmniSearch avec le préfixe `>` (convention CLI) :

```
> deploy to env          Deployment
> check disk usage       Monitoring
> rollback               Deployment
```

Sélectionner un snippet depuis l'OmniSearch lance le même flux d'injection.

### Filtres contextuels

Quand un snippet a `onlyForConnectionTags` ou `onlyForDistros`, il est **grisé** (pas masqué) si la connexion active ne correspond pas — avec un tooltip explicatif. L'utilisateur peut quand même l'exécuter volontairement.

---

## 7. Ce qui dépasse Termius

### Variables typées avec preview temps réel

Termius a des variables simples `{{var}}`. Ici : types, valeurs par défaut, labels, choices, et un preview qui se met à jour caractère par caractère dans la modale.

### Variables dynamiques

`{{clipboard}}`, `{{datetime}}`, `{{connection.name}}` — Termius ne les a pas.

### Mode "Insert sans exécuter"

Termius injecte et exécute toujours. Ici, le bouton `[Insert]` place le texte résolu dans le terminal sans appuyer sur Entrée — l'utilisateur peut relire, modifier, puis exécuter.

### Filtres contextuels

Snippets visibles/grisés selon les tags de connexion ou la distro détectée. Ex: les snippets `kubectl` n'apparaissent en évidence que sur les hôtes tagués `k8s`.

### Organisation

Dossiers imbriqués avec couleur et icône. Termius a des groupes plats.

### Intégration OmniSearch

Accès aux snippets depuis le command palette global, pas seulement depuis le panel latéral.

---

## 8. Roadmap

### Phase 1 — Snippets basiques

- [ ] Modèle de données `Snippet` + `SnippetFolder` (TypeScript + Rust)
- [ ] Commandes Tauri `snippets_load`, `snippets_save`
- [ ] Commande Tauri `snippet_inject(session_id, text, execute)`
- [ ] `SnippetsPanel.tsx` : liste, recherche, création, édition, suppression
- [ ] Injection directe (pas de variables) depuis le panel
- [ ] Activer la section `"snippets"` dans `RightPanel`

### Phase 2 — Système de variables

- [ ] `parseVariables()` côté TypeScript
- [ ] Résolution des variables dynamiques (`connection.*`, `date`, `timestamp`)
- [ ] Modale de résolution avec inputs typés et preview temps réel
- [ ] Boutons `[Insert]` et `[Execute]` distincts

### Phase 3 — Organisation & ergonomie

- [ ] Dossiers imbriqués avec couleur + icône
- [ ] Glisser-déposer pour réorganisation
- [ ] Favoris + section "Recent"
- [ ] Filtres contextuels `onlyForConnectionTags` + `onlyForDistros`
- [ ] Intégration OmniSearch (préfixe `>`)
- [ ] `{{clipboard}}` comme variable dynamique (permission clipboard Tauri)

### Phase 4 — Fonctionnalités avancées

- [ ] Import depuis un fichier `.sh` (chaque fonction → un snippet)
- [ ] Snippets multi-étapes (séquence de commandes avec délai configurable)
- [ ] Partage de snippets via vaults partagés (dépend de FUTURE.md §2)
