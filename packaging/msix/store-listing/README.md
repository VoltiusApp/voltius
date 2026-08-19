# Microsoft Store listing assets

Everything the Partner Center listing form asks for, in one place. Upload the
screenshots in filename order — the Store shows them in the order they are
listed, and the first one is what a browsing customer sees.

Regenerate the screenshots with `scripts/copy-store-screenshots.sh`; they are
copies of captures that live in the docs repo.

| File | Field | Caption to use |
| --- | --- | --- |
| `01-sftp-dual-pane.png` | Screenshot 1 | Dual-pane SFTP: drag and drop between local and remote |
| `02-folders-tags.png` | Screenshot 2 | Folders and tags keep a growing fleet navigable |
| `03-panes-grid.png` | Screenshot 3 | Split panes, with input broadcast to every pane |
| `04-command-palette.png` | Screenshot 4 | Jump to any host, session or snippet from one palette |
| `05-teams-roles.png` | Screenshot 5 | Shared vaults with roles and an audit log |
| `06-themes-creator.png` | Screenshot 6 | Theme editor for window colors and the terminal palette |
| `StorePoster1440x2160.png` | Store logos → 2:3 poster art | — |
| `StorePoster720x1080.png` | same field, smaller accepted size | — |
| `StoreLogo300x300.png` | Store logos → 1:1 App tile icon | — |

Regenerate the two logos with `scripts/make-store-poster.sh`.

## Rules these already satisfy

- Desktop screenshots must be PNG and **1366x768 or larger** — not one of two
  exact sizes. These are 1600x1148 (1600x1045 for the palette), so they qualify
  unchanged.
- Up to 10 screenshots, four recommended.
- Under 50 MB each.
- Nothing important sits in the bottom third, where the Store draws its own text
  overlays.
- No logos or marketing copy pasted onto the captures, which the Store rejects.

## Known blemish

`03-panes-grid.png` shows `tmux/screen not found - session will not survive
disconnects` in three panes, because the host used for the capture had neither
installed. It is honest and small, but it is a warning about a missing feature
sitting in a shop window. Worth recapturing against a host that has tmux, at
which point the pane also demonstrates the persistent-sessions feature instead
of contradicting it.

## The poster is not optional, whatever the docs say

Microsoft's documentation states that 2:3 poster art "does not apply to apps"
and is for games. The Partner Center form asks for it anyway, at **exactly**
720x1080 or 1440x2160 — no "or larger" here, unlike the screenshots. The form
wins; both sizes are provided.

The bolt sits in the top two-thirds and the bottom third is left empty, because
the Store draws its own text over that band. There is no wordmark on the image:
the docs allow one, but a rendered-in font would not match the brand and the
mark is distinctive on its own.

## Not needed

1:1 box art is for games. 16:9 hero art (1920x1080) is optional and must carry
no text and not show the app's UI — a marketing image rather than a screenshot.
