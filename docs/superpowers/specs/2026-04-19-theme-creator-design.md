# Theme Creator — Design Spec

**Date:** 2026-04-19

## Context

Custom theme creation currently lives in two places with divergent UX:
- `AppearanceSection.tsx` — simplified inline editor, no live preview, only 6 fields
- `RightPanel.tsx` `ThemesSection` — full 66-field editor with live preview

The goal is a single, dedicated theme creator that provides real-time color feedback across all major app views via a gallery of scene previews.

---

## Layout

Full-screen overlay mounted at app root (above all other UI). Two-panel:

```
┌────────────────────────────────────┬──────────────┐
│  [← Back]  Terminal                │  Theme Name  │
│                                    │  ──────────  │
│  ┌──────┐ ┌──────┐ ┌──────┐       │  General     │
│  │Term. │ │Home  │ │Sett. │       │  name        │
│  └──────┘ └──────┘ └──────┘       │  fontFamily  │
│  ┌──────┐ ┌──────┐                │  fontSize    │
│  │SFTP  │ │Hosts │                │  ──────────  │
│  └──────┘ └──────┘                │  Backgrounds │
│                                    │  ...         │
│  [expanded scene fills this area]  │  66 fields   │
│                                    │  ──────────  │
│                                    │  [Cancel][Save] │
└────────────────────────────────────┴──────────────┘
```

- **Left area (flex-1):** Gallery grid of 5 scene cards by default (no header/back in gallery mode). Clicking a card expands it to fill the full left area (spotlight mode); a back arrow (top-left) + scene name appear in the header only in spotlight mode.
- **Right panel (320px fixed):** Scrollable color editor. Top: theme name input + Save / Cancel. Below: General section (fontFamily, fontSize), then all 66 color fields in groups.

---

## Live Preview

Every draft change calls `applyThemeToDom(draft)` (existing function in `src/hooks/useApplyTheme.ts`). Since all UI uses `var(--t-*)` CSS variables, scene mockups update instantly with no extra wiring. On cancel, the previously active theme is re-applied.

---

## Scene Preview Cards

Five cards, each a faithful HTML/CSS miniature replica of the real app view using `var(--t-*)` variables:

| Card | What it shows |
|------|--------------|
| **Terminal** | Titlebar + tabs + terminal pane with sample ANSI-colored text |
| **Homepage** | Sidebar + vault list with connection cards + status dots |
| **Settings** | Settings modal with sections, inputs, cards, accent button |
| **SFTP** | File browser panel with directory tree + file list |
| **Hosts** | Hosts/connections list with status indicators |

Each card is a self-contained component. Expanded (spotlight) view is the same component, rendered larger — no separate implementation.

---

## State

Two new fields in `uiStore` (`src/stores/uiStore.ts`):

```ts
themeCreatorOpen: boolean
themeCreatorEditId: string | null  // null = new theme, string = edit existing
```

Two new actions:
```ts
openThemeCreator(editId?: string): void
closeThemeCreator(): void
```

---

## Entry Points

Both existing entry points call `openThemeCreator()`:

- `AppearanceSection.tsx` — existing inline editor **removed**, replaced with "Create Custom Theme" button + per-custom-theme "Edit" button
- `RightPanel.tsx` `ThemesSection` — existing creating/editing inline UI **removed**, "Create New Theme" and edit pencil buttons call `openThemeCreator()`

---

## File Structure

```
src/components/theme-creator/
  ThemeCreator.tsx          # Full-screen overlay, owns draft state
  previews/
    TerminalScene.tsx
    HomepageScene.tsx
    SettingsScene.tsx
    SftpScene.tsx
    HostsScene.tsx
```

---

## Modified Files

| File | Change |
|------|--------|
| `src/stores/uiStore.ts` | Add `themeCreatorOpen`, `themeCreatorEditId`, `openThemeCreator`, `closeThemeCreator` |
| `src/components/settings/sections/AppearanceSection.tsx` | Remove inline editor, add buttons calling `openThemeCreator` |
| `src/components/terminal/RightPanel.tsx` | Remove `ThemesSection` creating/editing state, add buttons calling `openThemeCreator` |
| `src/app/App.tsx` (or root layout) | Mount `<ThemeCreator />` at root so it overlays everything |

---

## Verification

1. Open settings → Appearance → click "Create Custom Theme" → ThemeCreator opens
2. Open RightPanel → Themes tab → click "Create New Theme" → same ThemeCreator opens
3. Edit any color in right panel → all 5 scene cards update instantly
4. Click a scene card → expands to fill left area → colors still update live
5. Click back arrow → returns to gallery
6. Click Save → theme saved, overlay closes, theme applied
7. Click Cancel → overlay closes, previous theme restored
8. Open with edit: RightPanel pencil button → ThemeCreator opens pre-populated with that theme's values
