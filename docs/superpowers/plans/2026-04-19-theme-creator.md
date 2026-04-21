# Theme Creator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dedicated full-screen theme creator overlay with a live-preview scene gallery, replacing the two divergent inline editors in AppearanceSection and RightPanel.

**Architecture:** A fixed full-screen overlay mounts at app root. The left area shows a gallery of 5 HTML/CSS scene mockups (Terminal, Homepage, Settings, SFTP, Hosts) — each designed at 960×600 and scaled via CSS transform. Clicking a card enters spotlight mode (scene fills left area). The right panel (320px) holds the full 66-field color editor. Every field change calls `applyThemeToDom(draft)` so all scenes update instantly via CSS variables. State (`themeCreatorOpen`, `themeCreatorEditId`) lives in `uiStore` (not persisted). Both AppearanceSection and RightPanel's inline editors are removed and replaced with buttons that call `openThemeCreator()`.

**Tech Stack:** React, Zustand, Tailwind CSS, CSS custom properties (`var(--t-*)`), existing `applyThemeToDom` hook

**Spec:** `docs/superpowers/specs/2026-04-19-theme-creator-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/stores/uiStore.ts` | Add `themeCreatorOpen`, `themeCreatorEditId`, `openThemeCreator`, `closeThemeCreator` |
| Create | `src/components/theme-creator/colorGroups.ts` | Color field groups & labels (extracted from RightPanel) |
| Create | `src/components/theme-creator/ThemeCreator.tsx` | Full-screen overlay, draft state, layout, color editor right panel |
| Create | `src/components/theme-creator/previews/TerminalScene.tsx` | Terminal UI scene mockup |
| Create | `src/components/theme-creator/previews/HomepageScene.tsx` | Homepage/vaults scene mockup |
| Create | `src/components/theme-creator/previews/SettingsScene.tsx` | Settings panel scene mockup |
| Create | `src/components/theme-creator/previews/SftpScene.tsx` | SFTP file browser scene mockup |
| Create | `src/components/theme-creator/previews/HostsScene.tsx` | Hosts list scene mockup |
| Modify | `src/app/App.tsx` | Mount `<ThemeCreator />` at root |
| Modify | `src/components/settings/sections/AppearanceSection.tsx` | Remove inline editor, add open buttons |
| Modify | `src/components/terminal/RightPanel.tsx` | Remove ThemesSection inline editor, add open buttons |

---

## Task 1: Add Theme Creator State to uiStore

**Files:**
- Modify: `src/stores/uiStore.ts`

- [ ] **Step 1: Add fields and actions to the interface**

In `src/stores/uiStore.ts`, add to the `UIStore` interface (after `importExportModal` and before `openImportExport`):

```ts
themeCreatorOpen: boolean;
themeCreatorEditId: string | null;
openThemeCreator: (editId?: string) => void;
closeThemeCreator: () => void;
```

- [ ] **Step 2: Add initial state and implementations in the create() call**

In the `create<UIStore>()` call body, after `importExportModal: { open: false, mode: "export" as const },` add:

```ts
themeCreatorOpen: false,
themeCreatorEditId: null as string | null,
openThemeCreator: (editId) => set({ themeCreatorOpen: true, themeCreatorEditId: editId ?? null }),
closeThemeCreator: () => set({ themeCreatorOpen: false, themeCreatorEditId: null }),
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /home/killian/projects/Voltius && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors related to uiStore.

- [ ] **Step 4: Commit**

```bash
git add src/stores/uiStore.ts
git commit -m "feat(ui-store): add themeCreator open/editId state"
```

---

## Task 2: Extract Color Groups to Shared File

**Files:**
- Create: `src/components/theme-creator/colorGroups.ts`

The color groups and labels currently live in `RightPanel.tsx`. Extract them to a shared file used by ThemeCreator. They will be removed from RightPanel in Task 7.

- [ ] **Step 1: Create `src/components/theme-creator/colorGroups.ts`**

```ts
import type { UITheme, TerminalTheme } from "@/themes/types";

export const UI_GROUPS: { label: string; fields: (keyof UITheme)[] }[] = [
  {
    label: "Backgrounds",
    fields: ["bgTerminal", "bgBase", "bgSidebar", "bgCard", "bgCardHover", "bgCardAvatar", "bgInput", "bgInputHover", "bgElevated", "bgModal"],
  },
  { label: "Borders", fields: ["border", "borderHover"] },
  {
    label: "Text",
    fields: ["textDim", "textMuted", "textSecondary", "textPrimary", "textBright"],
  },
  {
    label: "Accent & Tabs",
    fields: ["accent", "accentHover", "tabBg", "tabActiveBg", "tabActiveText", "tabActiveBorder"],
  },
  {
    label: "Vault Tabs",
    fields: ["vaultTabBg", "vaultTabActiveBg"],
  },
  {
    label: "Status",
    fields: ["statusConnected", "statusError", "statusConnecting", "statusWarning"],
  },
  {
    label: "Other",
    fields: ["textNotice"],
  },
];

export const TERMINAL_GROUPS: { label: string; fields: (keyof TerminalTheme)[] }[] = [
  {
    label: "Terminal Base",
    fields: ["background", "foreground", "cursor", "selectionBackground"],
  },
  {
    label: "ANSI Colors",
    fields: ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"],
  },
  {
    label: "Bright ANSI Colors",
    fields: ["brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite"],
  },
];

export const FIELD_LABELS: Record<string, string> = {
  bgTerminal: "Terminal / Titlebar", bgBase: "Base Background", bgSidebar: "Sidebar",
  bgCard: "Cards", bgCardHover: "Cards Hover", bgCardAvatar: "Card Avatar",
  bgInput: "Inputs", bgInputHover: "Inputs Hover", bgElevated: "Elevated / Hover", bgModal: "Modal / Panel",
  border: "Border", borderHover: "Border Hover",
  textDim: "Text Dim", textMuted: "Text Muted", textSecondary: "Text Secondary",
  textPrimary: "Text Primary", textBright: "Text Bright",
  accent: "Accent", accentHover: "Accent Hover",
  tabBg: "Tab Bg", tabActiveBg: "Tab Active Bg", tabActiveText: "Tab Active Text", tabActiveBorder: "Tab Active Border",
  vaultTabBg: "Vault Tab Bg", vaultTabActiveBg: "Vault Tab Active Bg",
  statusConnected: "Connected", statusError: "Error", statusConnecting: "Connecting", statusWarning: "Warning",
  textNotice: "Notice Text",
  background: "Background", foreground: "Foreground", cursor: "Cursor",
  selectionBackground: "Selection",
  black: "Black", red: "Red", green: "Green", yellow: "Yellow",
  blue: "Blue", magenta: "Magenta", cyan: "Cyan", white: "White",
  brightBlack: "Bright Black", brightRed: "Bright Red", brightGreen: "Bright Green",
  brightYellow: "Bright Yellow", brightBlue: "Bright Blue", brightMagenta: "Bright Magenta",
  brightCyan: "Bright Cyan", brightWhite: "Bright White",
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/killian/projects/Voltius && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/theme-creator/colorGroups.ts
git commit -m "feat(theme-creator): add shared color groups file"
```

---

## Task 3: Create Scene Mockup Components

**Files:**
- Create: `src/components/theme-creator/previews/TerminalScene.tsx`
- Create: `src/components/theme-creator/previews/HomepageScene.tsx`
- Create: `src/components/theme-creator/previews/SettingsScene.tsx`
- Create: `src/components/theme-creator/previews/SftpScene.tsx`
- Create: `src/components/theme-creator/previews/HostsScene.tsx`

Each scene renders at a fixed natural size of **960×600px**. The parent ThemeCreator wraps them in a `transform: scale(N)` container to fit card or spotlight dimensions. All colors use `var(--t-*)` so they update live with `applyThemeToDom`.

- [ ] **Step 1: Create `src/components/theme-creator/previews/TerminalScene.tsx`**

```tsx
export default function TerminalScene() {
  const tab = (label: string, active: boolean) => (
    <div style={{
      padding: "0 20px", height: "100%", display: "flex", alignItems: "center",
      fontSize: 13, fontFamily: "var(--t-font-family)",
      background: active ? "var(--t-tab-active-bg)" : "var(--t-tab-bg)",
      color: active ? "var(--t-tab-active-text)" : "var(--t-text-muted)",
      borderBottom: active ? "2px solid var(--t-tab-active-border)" : "2px solid transparent",
      cursor: "default", userSelect: "none",
    }}>{label}</div>
  );

  const line = (prompt: string, promptColor: string, cmd: string, cmdColor: string) => (
    <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "1px 0" }}>
      <span style={{ color: promptColor, fontFamily: "var(--t-font-family)", fontSize: 14 }}>{prompt}</span>
      <span style={{ color: cmdColor, fontFamily: "var(--t-font-family)", fontSize: 14 }}>{cmd}</span>
    </div>
  );

  return (
    <div style={{ width: 960, height: 600, display: "flex", flexDirection: "column", background: "var(--t-bg-terminal)", overflow: "hidden" }}>
      {/* Titlebar */}
      <div style={{ height: 44, background: "var(--t-bg-terminal)", borderBottom: "1px solid var(--t-border)", display: "flex", alignItems: "stretch", paddingLeft: 12, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: 16 }}>
          <div style={{ width: 13, height: 13, borderRadius: "50%", background: "#ff5f57" }} />
          <div style={{ width: 13, height: 13, borderRadius: "50%", background: "#febc2e" }} />
          <div style={{ width: 13, height: 13, borderRadius: "50%", background: "#28c840" }} />
        </div>
        {tab("prod-web-01", true)}
        {tab("staging", false)}
        {tab("local-dev", false)}
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", paddingRight: 16, gap: 12 }}>
          <div style={{ width: 22, height: 22, borderRadius: 6, background: "var(--t-bg-elevated)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 12, height: 12, borderRadius: 2, border: "1.5px solid var(--t-text-muted)" }} />
          </div>
        </div>
      </div>
      {/* Terminal body */}
      <div style={{ flex: 1, padding: "20px 28px", display: "flex", flexDirection: "column", gap: 4 }}>
        {line("killian@prod-web-01:~$", "var(--t-terminal-green, #21b568)", "git status", "var(--t-text-bright)")}
        <div style={{ color: "var(--t-text-secondary)", fontFamily: "var(--t-font-family)", fontSize: 14, paddingLeft: 4 }}>On branch main. Your branch is up to date.</div>
        {line("killian@prod-web-01:~$", "var(--t-terminal-green, #21b568)", "npm run build", "var(--t-text-bright)")}
        <div style={{ color: "var(--t-text-muted)", fontFamily: "var(--t-font-family)", fontSize: 14, paddingLeft: 4 }}>
          <span style={{ color: "#4ec9b0" }}>&gt; voltius@1.0.0 build</span>
        </div>
        <div style={{ color: "#dcdcaa", fontFamily: "var(--t-font-family)", fontSize: 14, paddingLeft: 4 }}>vite build --mode production</div>
        <div style={{ color: "#6a9955", fontFamily: "var(--t-font-family)", fontSize: 14, paddingLeft: 4 }}>✓ 1247 modules transformed.</div>
        <div style={{ color: "var(--t-text-secondary)", fontFamily: "var(--t-font-family)", fontSize: 14, paddingLeft: 4 }}>dist/index.html       0.46 kB</div>
        <div style={{ color: "var(--t-text-secondary)", fontFamily: "var(--t-font-family)", fontSize: 14, paddingLeft: 4 }}>dist/assets/index.js  312.4 kB</div>
        <div style={{ color: "#4ec9b0", fontFamily: "var(--t-font-family)", fontSize: 14, paddingLeft: 4 }}>✓ built in 3.42s</div>
        {line("killian@prod-web-01:~$", "var(--t-terminal-green, #21b568)", "", "var(--t-text-bright)")}
        <div style={{ display: "inline-block", width: 9, height: 18, background: "var(--t-text-bright)", marginLeft: 4, opacity: 0.9 }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/components/theme-creator/previews/HomepageScene.tsx`**

```tsx
export default function HomepageScene() {
  const vault = (initial: string, name: string, active: boolean) => (
    <div style={{
      width: 52, height: 52, borderRadius: 14,
      background: active ? "var(--t-accent)" : "var(--t-bg-card)",
      border: `1.5px solid ${active ? "var(--t-accent)" : "var(--t-border)"}`,
      display: "flex", alignItems: "center", justifyContent: "center",
      color: active ? "#fff" : "var(--t-text-muted)",
      fontSize: 18, fontWeight: 700, cursor: "default", userSelect: "none",
      position: "relative",
    }}>
      {initial}
      {active && <div style={{ position: "absolute", right: -4, top: "50%", transform: "translateY(-50%)", width: 4, height: 20, borderRadius: 2, background: "var(--t-accent)" }} />}
    </div>
  );

  const card = (name: string, host: string, status: "connected" | "error" | "idle") => {
    const statusColor = status === "connected" ? "var(--t-status-connected)" : status === "error" ? "var(--t-status-error)" : "var(--t-text-muted)";
    const statusLabel = status === "connected" ? "Connected" : status === "error" ? "Failed" : "Idle";
    return (
      <div style={{
        background: "var(--t-bg-card)", border: "1px solid var(--t-border)",
        borderRadius: 12, padding: "16px 20px", display: "flex", alignItems: "center", gap: 14,
      }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: "var(--t-bg-card-avatar)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--t-accent)", fontSize: 15, fontWeight: 700 }}>
          {name[0]}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ color: "var(--t-text-primary)", fontSize: 14, fontWeight: 600 }}>{name}</div>
          <div style={{ color: "var(--t-text-muted)", fontSize: 12, marginTop: 2 }}>{host}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: statusColor }} />
          <span style={{ color: statusColor, fontSize: 12 }}>{statusLabel}</span>
        </div>
      </div>
    );
  };

  return (
    <div style={{ width: 960, height: 600, display: "flex", background: "var(--t-bg-terminal)", overflow: "hidden" }}>
      {/* Sidebar */}
      <div style={{ width: 76, background: "var(--t-bg-terminal)", borderRight: "1px solid var(--t-border)", display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 16, gap: 10 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: "var(--t-accent)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 18, height: 18, background: "#fff", borderRadius: 4, opacity: 0.9 }} />
        </div>
        <div style={{ width: 28, height: 1, background: "var(--t-border)", margin: "4px 0" }} />
        {vault("P", "Production", true)}
        {vault("S", "Staging", false)}
        {vault("D", "Dev", false)}
        <div style={{ width: 28, height: 28, borderRadius: 8, border: "1.5px dashed var(--t-border)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--t-text-muted)", fontSize: 20 }}>+</div>
        <div style={{ flex: 1 }} />
        <div style={{ width: 34, height: 34, borderRadius: 10, background: "var(--t-bg-elevated)", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 16, height: 16, border: "1.5px solid var(--t-text-muted)", borderRadius: 3 }} />
        </div>
      </div>
      {/* Main area */}
      <div style={{ flex: 1, background: "var(--t-bg-base)", padding: "28px 32px", display: "flex", flexDirection: "column", gap: 16, overflow: "hidden" }}>
        <div style={{ color: "var(--t-text-bright)", fontSize: 20, fontWeight: 700 }}>Production</div>
        <div style={{ display: "flex", gap: 12, marginBottom: 4 }}>
          {["All", "Connected", "Idle", "Failed"].map((f, i) => (
            <div key={f} style={{ padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, background: i === 0 ? "var(--t-accent)" : "var(--t-bg-card)", color: i === 0 ? "#fff" : "var(--t-text-muted)", border: i === 0 ? "none" : "1px solid var(--t-border)" }}>{f}</div>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {card("web-prod-01", "ubuntu@10.0.1.12", "connected")}
          {card("db-primary", "root@10.0.1.20", "connected")}
          {card("worker-01", "ubuntu@10.0.1.31", "idle")}
          {card("cache-01", "redis@10.0.1.40", "error")}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `src/components/theme-creator/previews/SettingsScene.tsx`**

```tsx
export default function SettingsScene() {
  const navItem = (label: string, active: boolean) => (
    <div style={{
      padding: "8px 16px", borderRadius: 8, fontSize: 13,
      background: active ? "var(--t-bg-elevated)" : "transparent",
      color: active ? "var(--t-text-bright)" : "var(--t-text-muted)",
      cursor: "default", userSelect: "none",
    }}>{label}</div>
  );

  const inputRow = (label: string, value: string) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ color: "var(--t-text-muted)", fontSize: 12 }}>{label}</div>
      <div style={{
        padding: "8px 12px", borderRadius: 8, fontSize: 13,
        background: "var(--t-bg-input)", border: "1px solid var(--t-border)",
        color: "var(--t-text-primary)",
      }}>{value}</div>
    </div>
  );

  return (
    <div style={{ width: 960, height: 600, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--t-bg-base)", overflow: "hidden" }}>
      {/* Modal */}
      <div style={{
        width: 700, height: 480, background: "var(--t-bg-modal)",
        border: "1px solid var(--t-border)", borderRadius: 16,
        display: "flex", overflow: "hidden", boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
      }}>
        {/* Left nav */}
        <div style={{ width: 180, background: "var(--t-bg-sidebar)", borderRight: "1px solid var(--t-border)", padding: "20px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ color: "var(--t-text-dim)", fontSize: 10, fontWeight: 700, letterSpacing: 2, paddingLeft: 16, marginBottom: 8 }}>SETTINGS</div>
          {navItem("Appearance", true)}
          {navItem("Account", false)}
          {navItem("Vaults", false)}
          {navItem("Plugins", false)}
          {navItem("About", false)}
        </div>
        {/* Content */}
        <div style={{ flex: 1, padding: "28px 28px", overflow: "hidden", display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ color: "var(--t-text-dim)", fontSize: 10, fontWeight: 700, letterSpacing: 2 }}>INTERFACE</div>
          <div style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)", borderRadius: 10, padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
            {inputRow("Font Family", "Source Code Pro, monospace")}
            {inputRow("Font Size", "17")}
          </div>
          <div style={{ color: "var(--t-text-dim)", fontSize: 10, fontWeight: 700, letterSpacing: 2 }}>COLOR THEME</div>
          <div style={{ display: "flex", gap: 10 }}>
            {["Abyss", "Dracula", "Nord", "Tokyo Night"].map((name, i) => (
              <div key={name} style={{
                flex: 1, padding: "10px 0", borderRadius: 10, display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                background: i === 0 ? "var(--t-bg-elevated)" : "var(--t-bg-card)",
                border: `1.5px solid ${i === 0 ? "var(--t-accent)" : "var(--t-border)"}`,
              }}>
                <div style={{ width: 32, height: 22, borderRadius: 5, background: "var(--t-bg-terminal)" }} />
                <div style={{ fontSize: 11, color: i === 0 ? "var(--t-text-bright)" : "var(--t-text-muted)" }}>{name}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "auto" }}>
            <div style={{ padding: "8px 20px", borderRadius: 8, background: "var(--t-accent)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "default" }}>
              Create Custom Theme
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `src/components/theme-creator/previews/SftpScene.tsx`**

```tsx
export default function SftpScene() {
  const fileRow = (icon: string, name: string, size: string, isDir: boolean) => (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "7px 12px", borderBottom: "1px solid var(--t-border)",
      color: isDir ? "var(--t-text-bright)" : "var(--t-text-primary)", fontSize: 13,
    }}>
      <span style={{ color: isDir ? "var(--t-accent)" : "var(--t-text-muted)", fontSize: 14, width: 18, textAlign: "center" }}>{icon}</span>
      <span style={{ flex: 1 }}>{name}</span>
      <span style={{ color: "var(--t-text-muted)", fontSize: 12 }}>{size}</span>
    </div>
  );

  const pane = (title: string, path: string, files: [string, string, string, boolean][]) => (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "var(--t-bg-base)", overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", background: "var(--t-bg-elevated)", borderBottom: "1px solid var(--t-border)", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: "var(--t-text-dim)", fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: 1 }}>{title}</span>
      </div>
      <div style={{ padding: "6px 12px", borderBottom: "1px solid var(--t-border)", background: "var(--t-bg-input)" }}>
        <span style={{ color: "var(--t-text-muted)", fontSize: 12, fontFamily: "monospace" }}>{path}</span>
      </div>
      <div style={{ flex: 1, overflow: "hidden" }}>
        {files.map(([icon, name, size, isDir]) => fileRow(icon, name, size, isDir))}
      </div>
    </div>
  );

  return (
    <div style={{ width: 960, height: 600, display: "flex", flexDirection: "column", background: "var(--t-bg-terminal)", overflow: "hidden" }}>
      {/* Top bar */}
      <div style={{ height: 44, background: "var(--t-bg-terminal)", borderBottom: "1px solid var(--t-border)", display: "flex", alignItems: "center", padding: "0 20px", gap: 12 }}>
        <span style={{ color: "var(--t-text-bright)", fontSize: 14, fontWeight: 600 }}>SFTP</span>
        <div style={{ flex: 1 }} />
        <div style={{ padding: "5px 14px", borderRadius: 6, background: "var(--t-accent)", color: "#fff", fontSize: 12, fontWeight: 600 }}>Upload</div>
        <div style={{ padding: "5px 14px", borderRadius: 6, background: "var(--t-bg-elevated)", border: "1px solid var(--t-border)", color: "var(--t-text-primary)", fontSize: 12 }}>Download</div>
      </div>
      {/* Two-pane layout */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {pane("Local", "/home/killian/projects/voltius", [
          ["📁", "src", "—", true],
          ["📁", "docs", "—", true],
          ["📁", "dist", "—", true],
          ["📄", "package.json", "2.1 KB", false],
          ["📄", "vite.config.ts", "0.8 KB", false],
          ["📄", "tsconfig.json", "1.2 KB", false],
          ["📄", "README.md", "4.5 KB", false],
        ])}
        <div style={{ width: 1, background: "var(--t-border)" }} />
        {pane("Remote — prod-web-01", "/var/www/app", [
          ["📁", "public", "—", true],
          ["📁", "logs", "—", true],
          ["📄", "app.js", "154 KB", false],
          ["📄", "package.json", "2.1 KB", false],
          ["📄", ".env", "0.3 KB", false],
          ["📄", "pm2.config.js", "0.9 KB", false],
        ])}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create `src/components/theme-creator/previews/HostsScene.tsx`**

```tsx
export default function HostsScene() {
  const host = (
    name: string, addr: string, user: string,
    status: "connected" | "idle" | "error", tags: string[]
  ) => {
    const statusColor = status === "connected" ? "var(--t-status-connected)" : status === "error" ? "var(--t-status-error)" : "var(--t-text-muted)";
    return (
      <div style={{
        background: "var(--t-bg-card)", border: "1px solid var(--t-border)",
        borderRadius: 12, padding: "16px 20px", display: "flex", alignItems: "center", gap: 14,
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12, background: "var(--t-bg-card-avatar)",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "var(--t-accent)", fontSize: 16, fontWeight: 700,
        }}>{name[0].toUpperCase()}</div>
        <div style={{ flex: 1 }}>
          <div style={{ color: "var(--t-text-primary)", fontSize: 14, fontWeight: 600 }}>{name}</div>
          <div style={{ color: "var(--t-text-muted)", fontSize: 12, marginTop: 2 }}>{user}@{addr}</div>
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            {tags.map((t) => (
              <span key={t} style={{ padding: "2px 8px", borderRadius: 4, fontSize: 10, background: "var(--t-bg-elevated)", color: "var(--t-text-muted)", border: "1px solid var(--t-border)" }}>{t}</span>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: statusColor }} />
          <span style={{ color: statusColor, fontSize: 12, textTransform: "capitalize" as const }}>{status}</span>
        </div>
        <div style={{ padding: "6px 16px", borderRadius: 8, background: "var(--t-accent)", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "default" }}>Connect</div>
      </div>
    );
  };

  return (
    <div style={{ width: 960, height: 600, display: "flex", flexDirection: "column", background: "var(--t-bg-base)", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "20px 32px 12px", display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ color: "var(--t-text-bright)", fontSize: 20, fontWeight: 700, flex: 1 }}>Hosts</div>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ padding: "7px 16px", borderRadius: 8, background: "var(--t-bg-input)", border: "1px solid var(--t-border)", color: "var(--t-text-muted)", fontSize: 13 }}>Search...</div>
          <div style={{ padding: "7px 16px", borderRadius: 8, background: "var(--t-accent)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "default" }}>+ Add Host</div>
        </div>
      </div>
      {/* Nav */}
      <div style={{ padding: "0 32px", display: "flex", gap: 0, borderBottom: "1px solid var(--t-border)", marginBottom: 20 }}>
        {["All", "Production", "Staging", "Dev"].map((tab, i) => (
          <div key={tab} style={{
            padding: "8px 16px", fontSize: 13,
            color: i === 0 ? "var(--t-text-bright)" : "var(--t-text-muted)",
            borderBottom: i === 0 ? "2px solid var(--t-accent)" : "2px solid transparent",
            cursor: "default",
          }}>{tab}</div>
        ))}
      </div>
      {/* List */}
      <div style={{ flex: 1, padding: "0 32px", display: "flex", flexDirection: "column", gap: 10, overflow: "hidden" }}>
        {host("web-prod-01", "10.0.1.12", "ubuntu", "connected", ["nginx", "node"])}
        {host("db-primary", "10.0.1.20", "postgres", "connected", ["postgresql", "primary"])}
        {host("worker-01", "10.0.1.31", "ubuntu", "idle", ["node", "queue"])}
        {host("cache-01", "10.0.1.40", "redis", "error", ["redis", "cache"])}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd /home/killian/projects/Voltius && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/theme-creator/previews/
git commit -m "feat(theme-creator): add 5 scene mockup components"
```

---

## Task 4: Create ThemeCreator.tsx

**Files:**
- Create: `src/components/theme-creator/ThemeCreator.tsx`

The main overlay. Manages draft state, gallery/spotlight toggle, color editor, save/cancel.

- [ ] **Step 1: Create `src/components/theme-creator/ThemeCreator.tsx`**

```tsx
import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import { useUIStore } from "@/stores/uiStore";
import { useThemeStore } from "@/stores/themeStore";
import { BUILT_IN_THEMES } from "@/themes/presets";
import { applyThemeToDom } from "@/hooks/useApplyTheme";
import type { AppTheme, UITheme, TerminalTheme } from "@/themes/types";
import { UI_GROUPS, TERMINAL_GROUPS, FIELD_LABELS } from "./colorGroups";
import TerminalScene from "./previews/TerminalScene";
import HomepageScene from "./previews/HomepageScene";
import SettingsScene from "./previews/SettingsScene";
import SftpScene from "./previews/SftpScene";
import HostsScene from "./previews/HostsScene";

// Scenes rendered at 960×600 natural size
const SCENE_NATURAL_W = 960;
const SCENE_NATURAL_H = 600;

const SCENES = [
  { id: "terminal", label: "Terminal", Component: TerminalScene },
  { id: "homepage", label: "Homepage", Component: HomepageScene },
  { id: "settings", label: "Settings", Component: SettingsScene },
  { id: "sftp",     label: "SFTP",     Component: SftpScene     },
  { id: "hosts",    label: "Hosts",    Component: HostsScene    },
] as const;

type SceneId = (typeof SCENES)[number]["id"];

// Scale a scene to fit within targetW×targetH, preserving aspect ratio
function scaleToFit(targetW: number, targetH: number) {
  const scaleX = targetW / SCENE_NATURAL_W;
  const scaleY = targetH / SCENE_NATURAL_H;
  return Math.min(scaleX, scaleY);
}

function SceneCard({
  scene,
  cardW,
  cardH,
  onClick,
}: {
  scene: (typeof SCENES)[number];
  cardW: number;
  cardH: number;
  onClick: () => void;
}) {
  const scale = scaleToFit(cardW, cardH);
  const { Component } = scene;
  return (
    <button
      onClick={onClick}
      className="group relative rounded-xl overflow-hidden transition-all shrink-0"
      style={{
        width: cardW,
        height: cardH,
        border: "1.5px solid var(--t-border)",
        background: "var(--t-bg-card)",
        cursor: "pointer",
        padding: 0,
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--t-accent)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--t-border)"; }}
    >
      <div style={{ width: cardW, height: cardH, overflow: "hidden", pointerEvents: "none" }}>
        <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: SCENE_NATURAL_W, height: SCENE_NATURAL_H }}>
          <Component />
        </div>
      </div>
      {/* Label overlay */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        padding: "6px 10px",
        background: "linear-gradient(transparent, rgba(0,0,0,0.7))",
        color: "#fff", fontSize: 12, fontWeight: 600, textAlign: "left",
      }}>{scene.label}</div>
    </button>
  );
}

function ColorEditor({
  draft,
  setDraft,
}: {
  draft: AppTheme;
  setDraft: React.Dispatch<React.SetStateAction<AppTheme>>;
}) {
  const setUiColor = (field: keyof UITheme, value: string) =>
    setDraft((d) => ({ ...d, ui: { ...d.ui, [field]: value } }));
  const setTermColor = (field: keyof TerminalTheme, value: string) =>
    setDraft((d) => ({ ...d, terminal: { ...d.terminal, [field]: value } }));

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5">
      {/* General */}
      <div className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-widest text-[var(--t-text-dim)]">General</p>
        <label className="block">
          <span className="text-xs text-[var(--t-text-muted)]">Name</span>
          <input
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            className="w-full mt-1 px-2.5 py-1.5 rounded-md text-sm outline-none bg-[var(--t-bg-input)] border border-[var(--t-border)] text-[var(--t-text-primary)]"
            onFocus={(e) => (e.currentTarget.style.borderColor = "var(--t-accent)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--t-border)")}
          />
        </label>
        <label className="block">
          <span className="text-xs text-[var(--t-text-muted)]">Font Family</span>
          <input
            value={draft.fontFamily}
            onChange={(e) => setDraft((d) => ({ ...d, fontFamily: e.target.value }))}
            className="w-full mt-1 px-2.5 py-1.5 rounded-md text-sm outline-none font-mono bg-[var(--t-bg-input)] border border-[var(--t-border)] text-[var(--t-text-primary)]"
            onFocus={(e) => (e.currentTarget.style.borderColor = "var(--t-accent)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--t-border)")}
            placeholder="'Source Code Pro', monospace"
          />
        </label>
        <label className="block">
          <span className="text-xs text-[var(--t-text-muted)]">Font Size</span>
          <input
            type="number" min={8} max={24} value={draft.fontSize}
            onChange={(e) => setDraft((d) => ({ ...d, fontSize: Number(e.target.value) }))}
            className="w-full mt-1 px-2.5 py-1.5 rounded-md text-sm outline-none bg-[var(--t-bg-input)] border border-[var(--t-border)] text-[var(--t-text-primary)]"
            onFocus={(e) => (e.currentTarget.style.borderColor = "var(--t-accent)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--t-border)")}
          />
        </label>
      </div>

      {UI_GROUPS.map((group) => (
        <div key={group.label} className="space-y-1.5">
          <p className="text-xs font-bold uppercase tracking-widest text-[var(--t-text-dim)]">{group.label}</p>
          {group.fields.map((field) => (
            <div key={field} className="flex items-center gap-2">
              <input
                type="color"
                value={draft.ui[field]}
                onChange={(e) => setUiColor(field, e.target.value)}
                className="w-7 h-7 rounded cursor-pointer border-0 p-0.5 shrink-0 bg-[var(--t-bg-input)]"
              />
              <span className="text-xs flex-1 text-[var(--t-text-secondary)]">{FIELD_LABELS[field] ?? field}</span>
              <code className="text-xs font-mono text-[var(--t-text-muted)]">{draft.ui[field]}</code>
            </div>
          ))}
        </div>
      ))}

      {TERMINAL_GROUPS.map((group) => (
        <div key={group.label} className="space-y-1.5">
          <p className="text-xs font-bold uppercase tracking-widest text-[var(--t-text-dim)]">{group.label}</p>
          {group.fields.map((field) => (
            <div key={field} className="flex items-center gap-2">
              <input
                type="color"
                value={draft.terminal[field].startsWith("#") && draft.terminal[field].length >= 7
                  ? draft.terminal[field].slice(0, 7) : "#000000"}
                onChange={(e) => setTermColor(field, e.target.value)}
                className="w-7 h-7 rounded cursor-pointer border-0 p-0.5 shrink-0 bg-[var(--t-bg-input)]"
              />
              <span className="text-xs flex-1 text-[var(--t-text-secondary)]">{FIELD_LABELS[field] ?? field}</span>
              <code className="text-xs font-mono text-[var(--t-text-muted)]">{draft.terminal[field].slice(0, 7)}</code>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function ThemeCreator() {
  const { themeCreatorOpen, themeCreatorEditId, closeThemeCreator } = useUIStore();
  const { getActiveTheme, saveCustomTheme, setTheme, customThemes } = useThemeStore();

  const [spotlightId, setSpotlightId] = useState<SceneId | null>(null);
  const [restoreThemeId, setRestoreThemeId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AppTheme>(() => ({
    ...JSON.parse(JSON.stringify(getActiveTheme())),
    id: `custom-${Date.now()}`,
    name: "My Theme",
    builtIn: false,
  }));

  // Initialize draft when overlay opens
  useEffect(() => {
    if (!themeCreatorOpen) return;
    setSpotlightId(null);
    const active = getActiveTheme();
    setRestoreThemeId(active.id);

    if (themeCreatorEditId) {
      const existing = [...BUILT_IN_THEMES, ...customThemes].find((t) => t.id === themeCreatorEditId);
      if (existing) {
        setDraft(JSON.parse(JSON.stringify(existing)));
        return;
      }
    }
    setDraft({
      ...JSON.parse(JSON.stringify(active)),
      id: `custom-${Date.now()}`,
      name: "My Theme",
      builtIn: false,
    });
  }, [themeCreatorOpen, themeCreatorEditId]);

  // Live preview: apply draft to DOM on every change
  useEffect(() => {
    if (themeCreatorOpen) applyThemeToDom(draft);
  }, [themeCreatorOpen, draft]);

  const handleSave = useCallback(() => {
    saveCustomTheme(draft);
    setTheme(draft.id);
    closeThemeCreator();
  }, [draft, saveCustomTheme, setTheme, closeThemeCreator]);

  const handleCancel = useCallback(() => {
    if (restoreThemeId) {
      const all = [...BUILT_IN_THEMES, ...customThemes];
      const original = all.find((t) => t.id === restoreThemeId);
      if (original) applyThemeToDom(original);
    }
    closeThemeCreator();
  }, [restoreThemeId, customThemes, closeThemeCreator]);

  if (!themeCreatorOpen) return null;

  const spotlightScene = spotlightId ? SCENES.find((s) => s.id === spotlightId) : null;

  // Card dimensions for gallery grid
  const CARD_W = 280;
  const CARD_H = 175;

  return (
    <div
      className="fixed inset-0 z-[200] flex"
      style={{ background: "var(--t-bg-base)" }}
    >
      {/* Left: gallery or spotlight */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header (spotlight mode only) */}
        {spotlightScene && (
          <div className="flex items-center gap-3 px-4 py-3 shrink-0 border-b border-[var(--t-border)]">
            <button
              onClick={() => setSpotlightId(null)}
              className="p-1.5 rounded transition-colors text-[var(--t-text-muted)]"
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t-text-primary)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--t-text-muted)")}
            >
              <Icon icon="lucide:arrow-left" width={16} />
            </button>
            <span className="text-sm font-medium text-[var(--t-text-bright)]">{spotlightScene.label}</span>
          </div>
        )}

        {spotlightScene ? (
          // Spotlight: fill available space
          <div className="flex-1 overflow-hidden flex items-center justify-center p-6">
            <div className="w-full h-full overflow-hidden rounded-xl" style={{ border: "1px solid var(--t-border)" }}>
              <div style={{ width: "100%", height: "100%", overflow: "hidden" }}>
                <div style={{
                  transform: `scale(${scaleToFit(window.innerWidth - 320 - 48, window.innerHeight - 100)})`,
                  transformOrigin: "top left",
                  width: SCENE_NATURAL_W,
                  height: SCENE_NATURAL_H,
                }}>
                  <spotlightScene.Component />
                </div>
              </div>
            </div>
          </div>
        ) : (
          // Gallery grid
          <div className="flex-1 overflow-y-auto p-8">
            <div className="flex flex-wrap gap-5 justify-center">
              {SCENES.map((scene) => (
                <SceneCard
                  key={scene.id}
                  scene={scene}
                  cardW={CARD_W}
                  cardH={CARD_H}
                  onClick={() => setSpotlightId(scene.id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Right: color editor panel */}
      <div
        className="flex flex-col shrink-0 border-l border-[var(--t-border)] bg-[var(--t-bg-modal)]"
        style={{ width: 320 }}
      >
        {/* Panel header */}
        <div className="flex items-center gap-2 px-4 py-3 shrink-0 border-b border-[var(--t-border)]">
          <span className="text-sm font-medium flex-1 text-[var(--t-text-bright)]">
            {themeCreatorEditId ? "Edit Theme" : "New Theme"}
          </span>
          <button
            onClick={handleCancel}
            className="px-3 py-1 rounded-md text-xs font-medium transition-colors border border-[var(--t-border)] text-[var(--t-text-secondary)] bg-[var(--t-bg-elevated)]"
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-primary)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-secondary)"; }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-3 py-1 rounded-md text-xs font-medium transition-colors bg-[var(--t-accent)] text-white"
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--t-accent-hover)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--t-accent)"; }}
          >
            Save
          </button>
        </div>

        <ColorEditor draft={draft} setDraft={setDraft} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/killian/projects/Voltius && npx tsc --noEmit 2>&1 | head -40
```

Expected: no errors. If there are type errors around `draft.ui[field]` or `draft.terminal[field]`, they are expected — UITheme may have optional fields. Cast as needed: `(draft.ui as Record<string, string>)[field]`.

- [ ] **Step 3: Commit**

```bash
git add src/components/theme-creator/ThemeCreator.tsx
git commit -m "feat(theme-creator): add full-screen theme creator overlay"
```

---

## Task 5: Mount ThemeCreator in App.tsx

**Files:**
- Modify: `src/app/App.tsx`

- [ ] **Step 1: Add the import**

In `src/app/App.tsx`, add after the existing imports:

```tsx
import ThemeCreator from "@/components/theme-creator/ThemeCreator";
```

- [ ] **Step 2: Mount the component**

In the return JSX, add `<ThemeCreator />` immediately before the closing `</div>` of the root element (after `<NotificationToastContainer />`):

```tsx
      <NotificationToastContainer />
      <ThemeCreator />

      {/* Global snippet variable modal ... */}
```

- [ ] **Step 3: Start dev server and verify overlay renders**

```bash
cd /home/killian/projects/Voltius && npm run dev
```

Open the app. In the browser console run:
```js
// Temporarily test the overlay opens (open devtools console)
// This won't work directly — proceed to Task 6 to wire the buttons
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /home/killian/projects/Voltius && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 5: Commit**

```bash
git add src/app/App.tsx
git commit -m "feat(theme-creator): mount ThemeCreator at app root"
```

---

## Task 6: Update AppearanceSection.tsx

**Files:**
- Modify: `src/components/settings/sections/AppearanceSection.tsx`

Remove the inline custom theme editor (the `showEditor` state, `openNewEditor`, `handleBaseChange`, `handleSave`, editor JSX). Replace with a "Create Custom Theme" button and per-custom-theme "Edit" buttons that call `openThemeCreator`.

- [ ] **Step 1: Replace AppearanceSection.tsx entirely**

```tsx
import { Icon } from "@iconify/react";
import { useThemeStore } from "@/stores/themeStore";
import { BUILT_IN_THEMES } from "@/themes/presets";
import { useUIStore } from "@/stores/uiStore";
import ScaleSection from "./ScaleSection";

export default function AppearanceSection() {
  const { activeThemeId, customThemes, setTheme, deleteCustomTheme } = useThemeStore();
  const openThemeCreator = useUIStore((s) => s.openThemeCreator);

  const allThemes = [...BUILT_IN_THEMES, ...customThemes];

  const handleDelete = (id: string) => {
    deleteCustomTheme(id);
    if (activeThemeId === id) setTheme("abyss");
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-4 text-[var(--t-text-dim)]">
          Interface
        </h3>
        <ScaleSection />
      </div>

      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-4 text-[var(--t-text-dim)]">
          Color Theme
        </h3>

        <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))" }}>
          {allThemes.map((theme) => {
            const isActive = theme.id === activeThemeId;
            return (
              <button
                key={theme.id}
                onClick={() => setTheme(theme.id)}
                className="relative flex flex-col gap-2.5 p-3 rounded-xl text-left transition-all"
                style={{
                  background: isActive ? "var(--t-bg-elevated)" : "var(--t-bg-card)",
                  border: `1.5px solid ${isActive ? "var(--t-accent)" : "var(--t-border)"}`,
                }}
                onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--t-border-hover)"; }}
                onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--t-border)"; }}
              >
                {isActive && (
                  <span className="absolute top-2 right-2 w-4 h-4 rounded-full flex items-center justify-center bg-[var(--t-accent)]">
                    <Icon icon="lucide:check" width={9} className="text-white" />
                  </span>
                )}
                <div className="flex gap-1.5">
                  {[theme.ui.bgTerminal, theme.ui.accent, theme.ui.tabActiveText, theme.ui.statusConnected].map((color, i) => (
                    <span key={i} className="w-5 h-5 rounded-md shrink-0" style={{ background: color, border: "1px solid rgba(255,255,255,0.08)" }} />
                  ))}
                </div>
                <span className="text-xs font-medium leading-tight" style={{ color: isActive ? "var(--t-text-bright)" : "var(--t-text-primary)" }}>
                  {theme.name}
                </span>
                {!theme.builtIn && (
                  <div className="absolute bottom-2 right-2 flex gap-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); openThemeCreator(theme.id); }}
                      className="p-1 rounded opacity-0 hover:opacity-100 transition-opacity text-[var(--t-text-muted)]"
                      title="Edit theme"
                      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-primary)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-muted)"; }}
                    >
                      <Icon icon="lucide:pencil" width={11} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(theme.id); }}
                      className="p-1 rounded opacity-0 hover:opacity-100 transition-opacity text-[var(--t-status-error)]"
                      title="Delete theme"
                    >
                      <Icon icon="lucide:trash-2" width={11} />
                    </button>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <button
          onClick={() => openThemeCreator()}
          className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm transition-colors bg-[var(--t-bg-card)] text-[var(--t-text-muted)]"
          style={{ border: "1.5px dashed var(--t-border)" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--t-accent)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--t-accent)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--t-border)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-muted)"; }}
        >
          <Icon icon="lucide:plus" width={14} />
          New Custom Theme
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/killian/projects/Voltius && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Start dev server, open Settings → Appearance, click "New Custom Theme"**

```bash
cd /home/killian/projects/Voltius && npm run dev
```

Verify: ThemeCreator overlay opens. Change a color — all 5 scene cards should update live. Click Cancel — previous theme restored. Click Save — theme saved, overlay closes.

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/sections/AppearanceSection.tsx
git commit -m "feat(appearance): replace inline editor with ThemeCreator button"
```

---

## Task 7: Update RightPanel.tsx ThemesSection

**Files:**
- Modify: `src/components/terminal/RightPanel.tsx`

Remove the `ThemesSection` creating/editing inline state (the `creating`, `editId`, `draft`, `blankDraft`, `startCreate`, `startEdit`, `saveDraft`, `cancelDraft`, `setUiColor`, `setTermColor` state/handlers, and all JSX inside `if (creating)`). Replace create and edit buttons with `openThemeCreator()` calls. Remove the now-unused `UI_GROUPS`, `TERMINAL_GROUPS`, `FIELD_LABELS` constants (they now live in `colorGroups.ts`). Remove unused imports: `applyThemeToDom`, `AppTheme`, `UITheme`, `TerminalTheme`, `useRipple`.

- [ ] **Step 1: Rewrite ThemesSection in RightPanel.tsx**

Replace the entire `ThemesSection` function (lines 100–305 in the original) with this simplified version:

```tsx
function ThemesSection() {
  const { activeThemeId, customThemes, setTheme, deleteCustomTheme, getActiveTheme } = useThemeStore();
  const openThemeCreator = useUIStore((s) => s.openThemeCreator);
  const allThemes = [...BUILT_IN_THEMES, ...customThemes];

  return (
    <div className="flex flex-col h-full">
      {/* Font row */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer transition-colors border-b border-b-[var(--t-border)]"
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-bg-elevated)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        <div className="flex items-center gap-3">
          <Icon icon="lucide:type" width={15} className="text-[var(--t-text-muted)]" />
          <div>
            <p className="text-sm font-medium text-[var(--t-text-primary)]">Font</p>
            <p className="text-xs text-[var(--t-text-muted)]">
              {getActiveTheme().fontFamily.split(",")[0].replace(/'/g, "")} · {getActiveTheme().fontSize}px
            </p>
          </div>
        </div>
        <Icon icon="lucide:chevron-right" width={14} className="text-[var(--t-text-dim)]" />
      </div>

      <div className="px-4 pt-4 pb-2 shrink-0">
        <p className="text-sm font-medium text-[var(--t-text-bright)]">Themes</p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {allThemes.map((theme) => {
          const isActive = theme.id === activeThemeId;
          return (
            <div
              key={theme.id}
              onClick={() => setTheme(theme.id)}
              className="flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors border-b border-b-[var(--t-border)]"
              style={{ background: isActive ? "var(--t-bg-elevated)" : "transparent" }}
              onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = "var(--t-bg-card)"; }}
              onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
            >
              <div className="relative">
                <ThemePreview theme={theme} />
                {isActive && (
                  <div style={{ position: "absolute", inset: 0, borderRadius: 6, border: `2px solid ${theme.ui.tabActiveText}`, pointerEvents: "none" }} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: isActive ? theme.ui.tabActiveText : "var(--t-text-primary)" }}>
                  {theme.name}
                </p>
                <p className="text-xs mt-0.5 text-[var(--t-text-muted)]">
                  {isActive ? "∞ active" : theme.builtIn ? "built-in" : "custom"}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {!theme.builtIn && (
                  <>
                    <button
                      onClick={(e) => { e.stopPropagation(); openThemeCreator(theme.id); }}
                      className="p-1.5 rounded transition-colors text-[var(--t-text-muted)]"
                      onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t-text-primary)")}
                      onMouseLeave={(e) => (e.currentTarget.style.color = "var(--t-text-muted)")}
                      title="Edit"
                    >
                      <Icon icon="lucide:pencil" width={12} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteCustomTheme(theme.id); if (activeThemeId === theme.id) setTheme("abyss"); }}
                      className="p-1.5 rounded transition-colors text-[var(--t-text-muted)]"
                      onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t-status-error)")}
                      onMouseLeave={(e) => (e.currentTarget.style.color = "var(--t-text-muted)")}
                      title="Delete"
                    >
                      <Icon icon="lucide:trash-2" width={12} />
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}

        <button
          onClick={() => openThemeCreator()}
          className="w-full flex items-center gap-3 px-4 py-3.5 transition-colors text-[var(--t-accent)]"
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-bg-card)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <Icon icon="lucide:plus-circle" width={15} />
          <span className="text-sm font-medium">Create New Theme</span>
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Remove unused imports from RightPanel.tsx**

Remove these imports (no longer used after ThemesSection simplification):
- `applyThemeToDom` from `@/hooks/useApplyTheme`
- `AppTheme`, `UITheme`, `TerminalTheme` from `@/themes/types`
- `useRipple` from `@/hooks/useRipple`
- `useState, useEffect` if no longer used by any other component in the file (check PanelContent and other helpers first)

Add import:
```tsx
import { useUIStore } from "@/stores/uiStore";
```

Also remove `UI_GROUPS`, `TERMINAL_GROUPS`, `FIELD_LABELS` constant declarations from the top of the file.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /home/killian/projects/Voltius && npx tsc --noEmit 2>&1 | head -30
```

Fix any remaining type errors (usually unused variable warnings or missing imports).

- [ ] **Step 4: Start dev server, test both entry points**

```bash
cd /home/killian/projects/Voltius && npm run dev
```

Verify:
1. Settings → Appearance → "New Custom Theme" → ThemeCreator opens
2. RightPanel → Themes → "Create New Theme" → same ThemeCreator opens
3. Custom theme edit (pencil) button in both locations → ThemeCreator opens pre-populated
4. Color changes update all 5 scene cards live
5. Clicking a scene card expands it; back arrow returns to gallery
6. Cancel restores previous theme
7. Save stores theme and closes overlay

- [ ] **Step 5: Commit**

```bash
git add src/components/terminal/RightPanel.tsx
git commit -m "feat(right-panel): replace inline theme editor with ThemeCreator button"
```

---

## Verification Checklist

After all tasks complete:

- [ ] `npx tsc --noEmit` passes with 0 errors
- [ ] App builds: `npm run build` completes without errors
- [ ] ThemeCreator opens from AppearanceSection "New Custom Theme" button
- [ ] ThemeCreator opens from RightPanel "Create New Theme" button
- [ ] ThemeCreator opens pre-populated when editing a custom theme from either entry point
- [ ] All 5 scene cards visible in gallery; each renders a faithful miniature of that app area
- [ ] Changing any color in the right panel updates all scene cards instantly
- [ ] Clicking a scene card enters spotlight mode (fills left area)
- [ ] Back arrow exits spotlight mode, returns to gallery
- [ ] Spotlight scene also updates live with color changes
- [ ] Save: theme stored in customThemes, applied to app, overlay closes
- [ ] Cancel: previous theme restored, overlay closes
- [ ] Editing an existing custom theme pre-populates all fields correctly
- [ ] Built-in themes show no edit/delete buttons in both AppearanceSection and RightPanel
