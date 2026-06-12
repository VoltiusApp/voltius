# Surface system

How Voltius keeps one coherent design language across many surfaces.

## The principle

Coherence is **not** every surface looking the same. It is every surface's
treatment following the **same rule**. Surfaces may use different *materials*
(glass vs solid) and still read as one system — as long as the choice is
driven by the surface's **role**, not by mood or by which file was touched last.

The through-line that makes everything one family is a **shared core token
set** — every surface wears these:

| Token | Purpose |
|---|---|
| `--t-ring` / `--t-ring-strong` | crisp 1px edge |
| `--t-elev-1/2/3` | drop-shadow elevation scale |
| `--r-sm/md/lg` | radius scale |

On top of the core, two tokens express the **lit / glassy** character, and are
used *only* by the glass/object roles — content surfaces omit them on purpose:

| Token | Purpose |
|---|---|
| `--t-highlight` / `--t-highlight-strong` | top-edge inner light (lit from above) |
| `backdrop-filter: blur()` | translucency / frosting |

So coherence comes from the core tokens (ring + elevation + radius). The fill
**and** whether a surface is "lit" (sheen + blur + translucent) vs "calm"
(opaque, flat) are both chosen by role.

## Roles → treatment

| Role | Treatment | Class / primitive | Examples |
|---|---|---|---|
| **Objects you manipulate** | glossy depth (gradient sheen + ring + colored glow) | `.surface-glass`, `glossyTileStyle()` | host/key cards, distro tiles |
| **Transient chrome** | glass or float, light | `.surface-glass`, `.surface-float` | command palette, dropdowns, context menus, tooltips |
| **Content / reading surfaces** | **solid**, opaque, no blur — legibility first | `.surface-modal-solid` (or `<ModalCard solid>`) | changelog, settings |
| **Lightweight dialogs** | glass modal | `<ModalCard>` (default) | confirm, small prompts |
| **Primary action** | flat accent + ring | `.btn` + `.btn-primary` | every primary CTA |
| **Secondary action** | flat elevated + ring | `.btn` + `.btn-secondary` | every secondary action |
| **Ghost / danger** | flat (transparent / solid error) + ring | `.btn` + `-ghost` / `-danger` | every CTA |
| **Segmented switcher** | calm always (utility control) | `Pills` | auth modes, toolbars, form option rows |

### Why "content surfaces" are solid

Translucency + blur flatter *transient, lightweight* chrome but fight surfaces
you sit and read: they lower text contrast and add visual noise behind dense
body copy. So changelog and settings use `.surface-modal-solid` — the core ring
+ elevation tokens (same family), an opaque `--t-bg-base` fill, and **no sheen
or blur** so the surface reads calm and flat. This is also the look the old
pre-glass dialogs had, now promoted into the system as a role rather than a
one-off.

### Why buttons are flat

Buttons are **calm everywhere** — one flat treatment regardless of host surface.
`.btn-primary` is solid `--t-accent` + the core `--t-ring`; `.btn-secondary` is
flat `--t-bg-elevated` + ring; `.btn-danger` is solid `--t-status-error` + ring.
No gradient sheen, inset highlight, or colored glow. The lit/glossy depth is
reserved for **objects you manipulate** (cards, tiles) — a CTA is an action, not
an object, so it stays quiet. This removes the earlier lit/calm button split
(`.btn-primary-calm` etc.): there was only ever one button look worth keeping.

**Pills is calm everywhere.** A segmented switcher is a *utility control*, never
the lit focal object of a screen — all its uses are panels, toolbars and form
option rows. So its selected indicator is flat (`--t-bg-elevated` + `--t-ring`),
no gradient sheen, no glow. There is no "lit Pills" variant on purpose.

## How to add a new surface

1. Decide its **role** from the table above.
2. Use the matching class/primitive. Do **not** hand-roll
   `bg-(--t-bg-card) border ... boxShadow` — that is how surfaces drift
   off-system.
3. If no role fits, add a new variant that **reuses the shared tokens** and
   document it here. Never introduce a one-off shadow/fill that ignores them.

## WebKitGTK constraint

`color-mix(var(…))` must never be stored in a CSS custom property — it breaks
on WebKitGTK. Inline it inside the `.surface-*` utility classes (as they all
already do). The plain box-shadow/length tokens above are safe to store.
