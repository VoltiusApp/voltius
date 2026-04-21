# UI Layout — Plan d'architecture

> Restructuration du layout global : omnibar persistante, panels Arc-style, navigation repensée.  
> Voir [OMNI_SEARCH.md](OMNI_SEARCH.md) pour le comportement détaillé de l'omnibar.  
> Voir [PLUGIN_SYSTEM.md](PLUGIN_SYSTEM.md) pour l'extensibilité des panels via plugins.

---

## Table des matières

1. [Vue d'ensemble](#1-vue-densemble)
2. [Title bar](#2-title-bar)
3. [Left panel — comportement selon le contexte](#3-left-panel--comportement-selon-le-contexte)
4. [Right panel — Arc-style](#4-right-panel--arc-style)
5. [Comportement hover des panels](#5-comportement-hover-des-panels)
6. [Compatibilité plugin system](#6-compatibilité-plugin-system)
7. [Roadmap](#7-roadmap)

---

## 1. Vue d'ensemble

### Layout actuel

```text
┌──────────────────────────────────────────────────────┐
│ ☰  [Vaults▾] [prod-01 ×] [staging ×]  [+]  [⊞] [─][□][×] │  ← title bar (tabs ici)
├────────────┬─────────────────────────────────────────┤
│ Hosts      │                                         │
│ Keychain   │           MainPanel                     │
│ Port Fwd   │                                         │
│ Snippets   │                                         │
│ ...        │                                         │
└────────────┴─────────────────────────────────────────┘
```

### Layout cible

```text
┌──────────────────────────────────────────────────────────────┐
│ [⊣]  [  🔍  Search or type a command...  Ctrl+K  ]  [⊢]  [─][□][×] │  ← title bar épurée
├──┬───────────────────────────────────────────────────────┬───┤
│▐ │                                                       │ ▌ │  ← slivers (panels repliés)
│  │                  MainPanel                            │   │
│  │                                                       │   │
└──┴───────────────────────────────────────────────────────┴───┘

  hover left sliver →          hover right sliver →
┌──────────┬──────────────┐   ┌──────────────┬──────────┐
│ ● prod-01│              │   │              │ Snippets │
│ ● staging│  MainPanel   │   │  MainPanel   │ History  │
│ ──────── │              │   │              │ Themes   │
│ Hosts    │              │   │              │ Ports    │
│ Keychain │              │   │              │          │
└──────────┴──────────────┘   └──────────────┴──────────┘
```

La title bar se résume à **trois zones** : bouton left panel | omnibar centré | bouton right panel | window controls.

---

## 2. Title bar

### Structure

```text
[⌂]  [⊣ panel-left]  [         omnibar pill (centré)         ]  [panel-right ⊢]  [─][□][×]
```

- **`[⌂]`** — bouton Home, retour à la homepage (vault). Icône `lucide:house`. Toujours visible.
- **`[⊣]`** — toggle left panel (pin/unpin). Icône `lucide:panel-left`. Masqué sur la homepage (panel toujours ancré).
- **Omnibar pill** — toujours visible, cliquable, ouvre le modal OmniSearch. Voir [OMNI_SEARCH.md](OMNI_SEARCH.md).
- **`[⊢]`** — toggle right panel (pin/unpin). Icône `lucide:panel-right`. **Visible uniquement sur une session active.**
- Les **onglets SSH** disparaissent de la title bar — ils migrent dans le left panel.

### Omnibar pill (title bar)

```tsx
// Bouton toujours visible au centre de la title bar
<button
  onClick={() => setOmniOpen(true)}
  className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
  style={{
    background: "var(--t-bg-elevated)",
    border: "1px solid var(--t-border)",
    width: "340px",
    color: "var(--t-text-dim)",
  }}
>
  <Icon icon="lucide:search" width={13} />
  <span className="flex-1 text-left text-sm">Search or type a command...</span>
  <kbd>Ctrl+K</kbd>
</button>
```

---

## 3. Left panel — comportement selon le contexte

Le left panel a deux comportements distincts selon la vue active :

| Vue | Comportement | Raison |
| --- | ------------ | ------ |
| **Homepage (Vaults)** | Ancré, toujours visible — identique à la sidebar actuelle | Sur la homepage, l'utilisateur browse ses hosts, le panel doit être permanent |
| **Session active (terminal)** | Arc-style : sliver replié par défaut, hover expand, pin toggle | Maximiser l'espace terminal, le panel est secondaire |

Le bouton `[⊣]` est **masqué sur la homepage** (le panel y est toujours ouvert). Il n'apparaît que dans le contexte terminal.

---

## 3a. Left panel — Arc-style

### Contenu

Le left panel remplace la sidebar actuelle ET les onglets de la title bar :

```text
LEFT PANEL
─────────────────
● prod-01          ← sessions actives (status dot coloré)
● staging-02
─────────────────
  Hosts            ← nav items (icône + label)
  Keychain
  Port Forwarding
  Snippets
  Known Hosts
  Logs
─────────────────
  [Marketplace]    ← bottom actions (voir §6)
  [Settings]
```

Les sessions actives sont toujours en haut, séparées par un divider des nav items. Cliquer sur une session l'active exactement comme l'ancien onglet.

### États du panel

| État | Apparence | Déclencheur |
| ---- | --------- | ----------- |
| **Pinné ouvert** | Panel pleine largeur, permanent | Clic sur `[⊣]` |
| **Replié** | Sliver de ~4px visible sur le bord gauche | Clic sur `[⊣]` quand ouvert |
| **Hover expand** | Panel slide in par-dessus le contenu | Survol du sliver |
| **Auto-replié** | Retour à sliver | Souris quitte le panel |

### Sliver

Quand le panel est replié, une fine bordure colorée reste visible sur le bord gauche :

```tsx
// Sliver — toujours visible, déclencheur du hover expand
<div
  className="absolute left-0 top-0 bottom-0 w-1 cursor-pointer"
  style={{ background: "var(--t-border)", transition: "background 150ms" }}
  onMouseEnter={handleSliverHover}
  onMouseLeave={handlePanelLeave}
/>
```

### Overlay vs push

En mode hover (non pinné), le panel **s'affiche par-dessus** le contenu principal (pas de push/resize) — identique au comportement Arc. En mode pinné, il repousse le contenu.

### Largeur et animation

```tsx
// Valeurs cibles
const PANEL_WIDTH = 220;      // px, quand ouvert
const SLIVER_WIDTH = 4;       // px, quand replié
const TRANSITION = "width 180ms cubic-bezier(0.4, 0, 0.2, 1)";
```

---

## 4. Right panel — Arc-style

### Comportement identique au left panel, miroir à droite

Même logique : sliver visible à droite, hover expand, pin toggle via `[⊢]` dans la title bar.

### Contenu du right panel

Le right panel conserve ses sections actuelles (`RightPanelSection`) :

```text
RIGHT PANEL
─────────────────
  [Snippets]       ← sections natives
  [History]
  [Themes]
  [Ports]
─────────────────
  [plugin sections] ← sections injectées par plugins via api.ui.registerRightPanelSection()
```

### Migration depuis l'implémentation actuelle

Le composant `RightPanel.tsx` existe déjà. Il faut :

- Retirer le bouton toggle de la title bar actuel (remplacé par `[⊢]`)
- Envelopper le panel dans le comportement sliver/hover/pin
- Le contenu interne ne change pas

---

## 5. Comportement hover des panels

### State machine

```text
          clic [⊣]/[⊢]               clic [⊣]/[⊢]
REPLIÉ ──────────────────► PINNÉ ──────────────────► REPLIÉ
  │                                                    ▲
  │ hover sliver                    souris quitte      │
  ▼                                 le panel           │
HOVER EXPAND ──────────────────────────────────────────┘
```

### Implémentation React (sketch)

```tsx
type PanelState = "collapsed" | "pinned" | "hover";

function usePanel(side: "left" | "right") {
  const [state, setState] = useState<PanelState>("collapsed");
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>();

  const onSliverEnter = () => {
    clearTimeout(hoverTimer.current);
    setState((s) => s === "collapsed" ? "hover" : s);
  };

  const onPanelLeave = () => {
    // Délai court avant repli pour éviter le flickering
    hoverTimer.current = setTimeout(() => {
      setState((s) => s === "hover" ? "collapsed" : s);
    }, 150);
  };

  const toggle = () => {
    setState((s) => s === "pinned" ? "collapsed" : "pinned");
  };

  const isOpen = state === "pinned" || state === "hover";
  const isPinned = state === "pinned";

  return { isOpen, isPinned, toggle, onSliverEnter, onPanelLeave };
}
```

### Persistance de l'état pinné

L'état pinné (ouvert/fermé) de chaque panel est persisté dans `uiStore` (Zustand persist) — l'utilisateur retrouve son layout au prochain démarrage.

---

## 6. Compatibilité plugin system

### Left panel — items injectés par plugins

Les plugins peuvent ajouter des entrées dans le left panel via `api.ui.registerSidebarItem()` (déjà prévu dans [PLUGIN_SYSTEM.md §4](PLUGIN_SYSTEM.md)). Ils apparaissent après les nav items natifs.

### Marketplace et Settings en bas du left panel

```text
LEFT PANEL (bas)
─────────────────
  Marketplace    ← ouvre l'UI marketplace (ou via omnibar : "m>")
  Settings       ← ouvre les settings
```

Ces deux entrées sont natives (pas des plugins), toujours en bas du panel, séparées des nav items par un spacer `flex-1`.

### Right panel — sections plugins

Inchangé par rapport à [PLUGIN_SYSTEM.md](PLUGIN_SYSTEM.md) — `api.ui.registerRightPanelSection()` continue de fonctionner.

---

## 7. Roadmap

### Phase 1 — Title bar + omnibar pill ✅ (reverted to tabs layout)

- [x] ~~Retirer les onglets SSH~~ — **Reverted**: tabs restent dans la title bar (meilleur UX)
- [x] Ajouter l'omnibar pill dans `TitleBar.tsx` (260px, après les tabs)
- [x] Connecter `[⊢]` au right panel existant

### Phase 2 — Left panel Arc-style ✅

- [x] Créer `src/components/layout/LeftPanel.tsx` (remplace `Sidebar.tsx`)
- [x] Migrer les nav items depuis `Sidebar.tsx` vers `LeftPanel.tsx`
- [x] Ajouter Marketplace et Settings en bas du left panel
- [x] Implémenter le hook `usePanel` (`src/hooks/usePanel.ts` — collapsed / hover / pinned)
- [x] Sliver gauche comme déclencheur hover (terminal view)
- [x] Homepage : panel ancré (comme l'ancien Sidebar)
- [x] Persister l'état pinné dans `uiStore` (`leftPanelPinned`, via zustand persist)
- Note : sessions SSH restent dans les tabs TitleBar (pas dans le LeftPanel)

### Phase 3 — Right panel Arc-style ✅

- [x] Envelopper le `RightPanel.tsx` existant dans le comportement sliver/hover/pin (via `usePanel`)
- [x] Sliver droit comme déclencheur hover
- [x] Persister l'état pinné dans `uiStore` (`rightPanelOpen` sert de pin state)
- [x] `[⊢]` dans TitleBar connecté au right panel (toggle pin)
- [x] RightPanel déplacé dans le flex layout (`App.tsx`) — plus de positionnement fixe

### Phase 4 — Intégration plugin system

- [ ] `LeftPanel.tsx` lit `pluginStore.sidebarItems` (déjà prévu, juste à brancher)
- [ ] Tester que `api.ui.registerSidebarItem()` injecte correctement dans le left panel
