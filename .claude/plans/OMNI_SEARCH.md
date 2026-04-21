# OmniSearch — Plan d'amélioration

> Améliorations de l'OmniSearch existant : disponibilité globale, gestion du focus terminal, raccourcis multiples, catégories PowerToys-style.  
> Fichiers concernés : `src/components/omni/OmniSearch.tsx`, `src/stores/shortcutStore.ts`, `src/components/shortcuts/ShortcutsPanel.tsx`, `src/hooks/useTerminal.ts`.  
> Voir [UI.md](UI.md) pour le layout global et l'omnibar pill persistante dans la title bar.

---

## Table des matières

1. [Disponibilité globale](#1-disponibilité-globale)
2. [Conflit avec le focus terminal](#2-conflit-avec-le-focus-terminal)
3. [Raccourcis multiples](#3-raccourcis-multiples)
4. [Refactors shortcutStore](#4-refactors-shortcutstore)
5. [Mise à jour ShortcutsPanel](#5-mise-à-jour-shortcutspanel)
6. [Sélecteurs de catégories](#6-sélecteurs-de-catégories)
7. [Roadmap](#7-roadmap)

---

## 1. Disponibilité globale

### Problème actuel

L'OmniSearch est probablement conditionnée à un état de navigation ou rendue dans un composant enfant. Elle n'est pas accessible depuis le terminal ou certains panels.

### Solution : render au niveau racine

L'OmniSearch doit être rendue dans `App.tsx`, au même niveau que `MainPanel` — pas à l'intérieur d'un panel spécifique :

```typescript
// src/app/App.tsx
export default function App() {
  const omniOpen = useUIStore((s) => s.omniOpen);
  const setOmniOpen = useUIStore((s) => s.setOmniOpen);

  return (
    <AccountGuard>
      <MainPanel />
      {omniOpen && <OmniSearch onClose={() => setOmniOpen(false)} />}
      {/* autres overlays globaux : ShortcutsPanel, etc. */}
    </AccountGuard>
  );
}
```

Le `fixed inset-0` de l'OmniSearch garantit qu'elle s'affiche par-dessus tout, quel que soit l'état de navigation.

---

## 2. Conflit avec le focus terminal

### Le problème

Quand xterm.js a le focus, il capture les événements clavier **avant** `window.addEventListener`. Appuyer sur `Ctrl+K` dans un terminal envoie le signal `^K` (kill-to-end-of-line readline) à la session SSH — pas à l'app.

### Solution : `customKeyEventHandler` xterm.js

xterm.js expose un hook exécuté **avant** tout traitement interne. Si il retourne `false`, la touche n'est pas transmise au terminal.

```typescript
// src/hooks/useTerminal.ts — dans l'initialisation de l'instance xterm

terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
  // Ctrl+Shift+P → toujours intercepter (jamais utilisé par les shells)
  if (e.ctrlKey && e.shiftKey && e.key === "P") {
    if (e.type === "keydown") useUIStore.getState().setOmniOpen(true);
    return false;
  }

  // F1 → toujours intercepter
  if (e.key === "F1") {
    if (e.type === "keydown") useUIStore.getState().setOmniOpen(true);
    return false;
  }

  // Ctrl+K → passer au terminal quand il est focusé
  // (kill-to-end-of-line, comportement natif préservé)
  // Le handler window.addEventListener dans useKeyboard.ts
  // ne se déclenche pas quand xterm.js a le focus de toute façon.

  return true; // tout le reste passe au terminal
});
```

### Comportement résultant par contexte

| Raccourci | Terminal focusé | Anywhere else |
| --------- | --------------- | ------------- |
| `Ctrl+K` | `^K` envoyé au shell (kill line) | Ouvre OmniSearch |
| `Ctrl+Shift+P` | Ouvre OmniSearch (intercepté) | Ouvre OmniSearch |
| `F1` | Ouvre OmniSearch (intercepté) | Ouvre OmniSearch |

### Pourquoi Ctrl+Shift+P et F1 sont sûrs à intercepter

- `Ctrl+Shift+P` : aucun shell ou programme CLI courant ne l'utilise
- `F1` : rarement utilisé dans des sessions SSH interactives (vim l'ignore, bash ne le mappe pas par défaut)
- `Ctrl+K` : utilisé activement dans readline/bash/zsh → ne pas intercepter depuis le terminal

---

## 3. Raccourcis multiples

### Concept : primary + aliases

Deux catégories de raccourcis pour une action :

- **Primary** : le raccourci principal, rebindable par l'utilisateur (ex: `Ctrl+K`, modifiable en `Ctrl+Space` ou autre)
- **Aliases** : raccourcis fixes non-rebindables, toujours actifs (ex: `Ctrl+Shift+P`, `F1`)

Les aliases sont des **conventions de l'app**, pas des préférences utilisateur. Ils sont hardcodés dans la définition du shortcut, pas dans le store persisté.

### Définition dans shortcutStore

```typescript
interface ShortcutAlias {
  key: string;
  ctrl: boolean;
  shift: boolean;
  label: string;   // affiché dans le panel ("Ctrl+Shift+P", "F1")
}

interface Shortcut {
  id: string;
  label: string;
  description: string;
  defaultKey: string;
  key: string;
  ctrl: boolean;
  shift: boolean;
  aliases?: ShortcutAlias[];   // nouveau — non persisté, toujours actifs
}
```

```typescript
// Définition mise à jour dans DEFAULTS
{ 
  id: "omni",
  label: "Omni Search",
  description: "Search hosts, tabs & commands",
  defaultKey: "k", ctrl: true, shift: false,
  aliases: [
    { key: "P",  ctrl: true,  shift: true,  label: "Ctrl+Shift+P" },
    { key: "F1", ctrl: false, shift: false, label: "F1" },
  ]
},
```

### Détection dans useKeyboard.ts

```typescript
// src/hooks/useKeyboard.ts
function matchShortcut(id: string, e: KeyboardEvent): boolean {
  const sc = useShortcutStore.getState().shortcuts.find((s) => s.id === id);
  if (!sc) return false;

  const ctrl = e.ctrlKey || e.metaKey;

  // Vérifie le primary
  if (ctrl === sc.ctrl && e.shiftKey === sc.shift && e.key === sc.key) return true;

  // Vérifie les aliases
  return sc.aliases?.some(
    (a) => ctrl === a.ctrl && e.shiftKey === a.shift && e.key === a.key
  ) ?? false;
}
```

---

## 4. Refactors shortcutStore

### Changements mineurs dans `shortcutStore.ts`

1. Ajouter `aliases?: ShortcutAlias[]` à l'interface `Shortcut`
2. Ajouter les aliases à l'entrée `omni` dans `DEFAULTS`
3. `matchShortcut` : vérifier primary + aliases (voir §3)
4. `formatShortcut` : inchangé (affiche uniquement le primary)

Les aliases ne sont **pas persistés** dans localStorage — ils font partie de la définition statique. Changer de version de l'app peut ajouter/retirer des aliases sans migration.

### Détection de conflit mise à jour

Dans `ShortcutsPanel.tsx`, la détection de conflit doit aussi vérifier les aliases des autres shortcuts :

```typescript
const existing = shortcuts.find((sc) => {
  if (sc.id === recording) return false;
  // Conflit avec primary
  if (sc.key === key && sc.ctrl === ctrl && sc.shift === shift) return true;
  // Conflit avec un alias
  return sc.aliases?.some(
    (a) => a.key === key && a.ctrl === ctrl && a.shift === shift
  ) ?? false;
});
```

---

## 5. Mise à jour ShortcutsPanel

### Affichage des aliases

Chaque ligne du panel affiche le primary (rebindable) + les aliases (badges fixes, non cliquables) :

```text
Omni Search         [Ctrl+K ✎]  +  [Ctrl+Shift+P]  [F1]
Search hosts & tabs
```

```typescript
// Dans le rendu de chaque shortcut
<div className="flex items-center gap-1.5 shrink-0">
  
  {/* Primary — cliquable pour rebinder */}
  <button onClick={() => setRecording(sc.id)} ...>
    {isRecording ? "Press key…" : formatShortcut(sc)}
  </button>

  {/* Aliases — badges fixes, non rebindables */}
  {sc.aliases?.map((alias) => (
    <span
      key={alias.label}
      title="Fixed shortcut — always active"
      style={{
        background: "var(--t-bg-base)",
        border: "1px solid var(--t-border)",
        color: "var(--t-text-dim)",
        // légèrement plus discret que le primary
      }}
      className="px-2 py-0.5 rounded text-xs font-mono"
    >
      {alias.label}
    </span>
  ))}

</div>
```

### Résultat visuel attendu

```text
┌─────────────────────────────────────────────────────┐
│ Omni Search                                          │
│ Search hosts, tabs & commands                        │
│                              [Ctrl+K]  [Ctrl+⇧P] [F1]│
├─────────────────────────────────────────────────────┤
│ Shortcuts Panel                                      │
│ Show/hide this panel                    [Ctrl+Space] │
├─────────────────────────────────────────────────────┤
│ Theme Panel                                          │
│ Open theme selector                         [Ctrl+,] │
└─────────────────────────────────────────────────────┘
```

Les badges aliases sont visuellement plus discrets (couleur `text-dim`, border moins marquée) pour distinguer "tu peux changer ça" vs "c'est fixe".

---

## 6. Sélecteurs de catégories

L'omnibar s'inspire de PowerToys Command Palette / VS Code : saisir un préfixe restreint les résultats à une catégorie. Cliquer sur un badge de catégorie dans l'interface insère automatiquement le préfixe dans l'input.

### Structure des résultats (sans préfixe)

```text
┌─────────────────────────────────────────────────┐
│ 🔍 ________________________________  Ctrl+K      │
├─────────────────────────────────────────────────┤
│ [All] [> Snippets] [m> Marketplace] [@ Settings]│  ← badges catégories cliquables
├─────────────────────────────────────────────────┤
│ CONNEXIONS ACTIVES                               │
│ ● prod-01   connected                            │
│ ● staging   connecting...                        │
├─────────────────────────────────────────────────┤
│ RÉCENT                                           │
│   dev-server                                     │
│   prod-db                                        │
├─────────────────────────────────────────────────┤
│ HOSTS                                            │
│   prod-01  /  prod-02  /  staging  ...           │
├─────────────────────────────────────────────────┤
│ ACTIONS                                          │
│   Sync now  /  Import ~/.ssh/config  ...         │
└─────────────────────────────────────────────────┘
```

Les connexions actives sont toujours en tête — permettre le switch rapide de session est l'action la plus fréquente.

### Préfixes de catégories

| Préfixe | Catégorie | Exemples de résultats |
| ------- | --------- | --------------------- |
| *(rien)* | Tout | Connexions actives, récents, hosts, actions plugins |
| `>` | Snippets | Liste des snippets, insertion rapide |
| `m>` | Marketplace | Recherche dans les index configurés, installer un plugin |
| `@` | Settings | Pages de settings (natives + plugins) |
| `ssh` | Quick connect | Parse `ssh user@host` et ouvre une connexion directe |

Les plugins enregistrent leurs commandes via `api.omni.register()` — elles apparaissent dans la section **Actions** sans préfixe, ou peuvent déclarer leur propre préfixe dans le manifest (à définir en v2).

### Comportement des badges

Cliquer sur un badge insère son préfixe dans l'input et filtre immédiatement :

```tsx
// Exemple : clic sur [m> Marketplace]
setQuery("m> ");
inputRef.current?.focus();
// → les résultats affichent uniquement le marketplace
```

Appuyer sur `Backspace` depuis un input vide avec préfixe revient à la vue "All".

### Section "Récent"

Historique des 5 dernières connexions utilisées, persisté dans `uiStore`. Ne nécessite pas de préfixe — toujours visible dans la vue "All" quand l'input est vide.

```typescript
// uiStore — ajout
recentConnections: string[];  // ids, max 5, FIFO
addRecentConnection: (id: string) => void;
```

## 7. Roadmap

### Phase 1 — Disponibilité globale ✅

- [x] Déplacer le render `<OmniSearch>` dans `App.tsx`
- [x] Vérifier que `useUIStore.omniOpen` est accessible depuis `App.tsx`
- [ ] Tester l'ouverture depuis tous les états de navigation

### Phase 2 — Raccourcis multiples ✅

- [x] Ajouter `ShortcutAlias` interface dans `shortcutStore.ts`
- [x] Ajouter aliases `Ctrl+Shift+P` et `F1` à l'entrée `omni` (via `ALIASES` statique)
- [x] Mettre à jour `matchShortcut` pour vérifier primary + aliases
- [x] Mettre à jour la détection de conflit dans `ShortcutsPanel.tsx`
- [x] Afficher les badges aliases dans `ShortcutsPanel.tsx`

### Phase 3 — Gestion focus terminal ✅

- [x] Ajouter `customKeyEventHandler` dans `useTerminal.ts`
- [x] Intercepter `Ctrl+Shift+P` et `F1` → `setOmniOpen(true)` + `return false`
- [x] Laisser `Ctrl+K` passer au terminal (comportement natif préservé)
- [ ] Tester que `^K` fonctionne toujours dans bash/zsh quand terminal focusé

### Phase 4 — Omnibar persistant + catégories ✅

- [x] Ajouter l'omnibar pill dans `TitleBar.tsx` (cliquable → `setOmniOpen(true)`)
- [x] Ajouter `recentConnections: string[]` et `addRecentConnection` dans `uiStore` (persisté via zustand persist)
- [x] Alimenter `recentConnections` à chaque connexion SSH établie (`sessionStore.startSession`)
- [x] Section "Connexions actives" en tête des résultats (sans préfixe)
- [x] Section "Récent" sous les connexions actives (sans préfixe, input vide)
- [x] Badges de catégories cliquables en haut du modal (insèrent le préfixe dans l'input)
- [x] Filtrage par préfixe : `>` snippets, `m>` marketplace, `@` settings, `ssh` quick connect
- [ ] Brancher les commandes plugins (`pluginStore.omniCommands`) dans la section Actions (attente plugin system)
