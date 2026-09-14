import type { Terminal } from "@xterm/xterm";
import { ClipboardAddon, type IClipboardProvider } from "@xterm/addon-clipboard";
import { writeClipboard, readClipboard } from "@/utils/clipboard";
import { getToggle } from "@/stores/toggleSettingsStore";

export interface TerminalClipboardHandle {
  /** Returns false to consume the event, true to let xterm process it,
   *  or null when the event is not a clipboard shortcut. */
  handleKeyEvent(e: KeyboardEvent): boolean | null;
  dispose(): void;
}

export interface TerminalClipboardOptions {
  /** Enable OSC 52: let the remote program write the local clipboard.
   *  Reads (paste-requests) are always refused. Off by default. */
  osc52?: boolean;
}

/**
 * Wire the full terminal clipboard behavior onto a terminal + its container:
 * copy-on-select (with feedback badge), smart Ctrl+C / Ctrl+Shift+C, paste
 * (Ctrl+V / Ctrl+Shift+V / right-click), and optionally OSC 52.
 *
 * Mouse/selection listeners are owned here; key handling is exposed via
 * `handleKeyEvent` so callers can fold it into their own key handler.
 */
export function attachTerminalClipboard(
  term: Terminal,
  container: HTMLElement,
  opts: TerminalClipboardOptions = {},
): TerminalClipboardHandle {
  // ── copy-on-select feedback badge ────────────────────────────────────────
  let badgeEl: HTMLDivElement | null = null;
  let badgeTimer: ReturnType<typeof setTimeout> | null = null;

  const hideBadge = () => {
    if (badgeTimer !== null) { clearTimeout(badgeTimer); badgeTimer = null; }
    badgeEl?.remove();
    badgeEl = null;
  };

  const showBadge = (x: number, y: number) => {
    hideBadge();
    if (!getToggle("select-to-copy")) return;
    const bw = 46;
    const bh = 28;
    let bx = x + 8;
    let by = y - bh - 8;
    if (bx + bw > window.innerWidth) bx = x - bw - 8;
    if (by < 0) by = y + 8;
    const el = document.createElement("div");
    Object.assign(el.style, {
      position: "fixed",
      zIndex: "10000",
      left: `${bx}px`,
      top: `${by}px`,
      width: `${bw}px`,
      height: `${bh}px`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "3px",
      borderRadius: "6px",
      background: "var(--t-bg-card)",
      border: "1px solid var(--t-border)",
      color: "var(--t-text-primary)",
      boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
      pointerEvents: "none",
      opacity: "0",
      transform: "translateY(4px)",
      transition: "opacity 100ms ease-out, transform 100ms ease-out",
    });
    el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    document.body.appendChild(el);
    badgeEl = el;
    requestAnimationFrame(() => {
      if (badgeEl !== el) return;
      el.style.opacity = "1";
      el.style.transform = "translateY(0)";
      badgeTimer = setTimeout(() => {
        el.style.opacity = "0";
        el.style.transform = "translateY(4px)";
        badgeTimer = setTimeout(() => {
          if (badgeEl === el) hideBadge();
        }, 110);
      }, 1200);
    });
  };

  // ── drag-selects-text over an app that holds the mouse ───────────────────
  const core = (term as unknown as {
    _core?: {
      coreMouseService?: { activeProtocol: string };
      _selectionService?: { disable(): void; _enabled: boolean };
    };
  })._core;
  const mouseService = core?.coreMouseService;

  let parkedProtocol: string | null = null;
  let pressed: MouseEvent | null = null;
  let replaying = false;

  const dragSelectsText = () =>
    !!mouseService &&
    term.modes.mouseTrackingMode !== "none" &&
    getToggle("drag-selects-text");

  const cloneMouse = (type: string, src: MouseEvent) =>
    new MouseEvent(type, {
      bubbles: true, cancelable: true, view: src.view,
      clientX: src.clientX, clientY: src.clientY,
      screenX: src.screenX, screenY: src.screenY,
      button: src.button, buttons: src.buttons, detail: src.detail,
      ctrlKey: src.ctrlKey, altKey: src.altKey, metaKey: src.metaKey, shiftKey: src.shiftKey,
    });

  const unpark = () => {
    if (parkedProtocol === null || !mouseService) return;
    // Handing the protocol back disables xterm's selection, and disabling it
    // clears the selection this drag just made — so keep the clear out of it.
    const selection = core?._selectionService;
    const disable = selection?.disable;
    if (selection && disable) selection.disable = () => { selection._enabled = false; };
    mouseService.activeProtocol = parkedProtocol;
    if (selection && disable) selection.disable = disable;
    parkedProtocol = null;
  };

  // The app was skipped on press, so a click that never became a drag is
  // handed to it now, press and release together.
  const replayToApp = (src: MouseEvent) => {
    const target = src.target as HTMLElement | null;
    if (!target) return;
    replaying = true;
    target.dispatchEvent(cloneMouse("mousedown", src));
    document.dispatchEvent(cloneMouse("mouseup", src));
    replaying = false;
  };

  // A drag that starts in the terminal often ends outside it (window padding,
  // another pane, past the window edge). Arm on mousedown inside the container
  // and resolve on the window so those releases still copy.
  let dragging = false;
  const handleMouseDown = (e: MouseEvent) => {
    if (replaying || e.button !== 0) return;
    dragging = true;
    if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
    if (!dragSelectsText() || !mouseService) return;
    // Parking at NONE before xterm's own listeners run re-enables its
    // selection; the app gets the mouse back on release.
    if (parkedProtocol === null) parkedProtocol = mouseService.activeProtocol;
    mouseService.activeProtocol = "NONE";
    pressed = e;
  };
  const handleMouseUp = (e: MouseEvent) => {
    if (replaying) return;
    const press = pressed;
    pressed = null;
    unpark();
    if (press) {
      const moved = Math.abs(e.clientX - press.clientX) + Math.abs(e.clientY - press.clientY) >= 4;
      if (!moved && !term.getSelection()) replayToApp(press);
    }
    if (!dragging) return;
    dragging = false;
    // Copy-on-select is opt-out: when the "Select to Copy" toggle is off, a
    // selection must NOT touch the clipboard (#50). Explicit Ctrl+Shift+C still
    // copies regardless.
    if (!getToggle("select-to-copy")) return;
    setTimeout(() => {
      const sel = term.getSelection();
      if (sel) {
        writeClipboard(sel);
        showBadge(e.clientX, e.clientY);
      }
    }, 20);
  };
  container.addEventListener("mousedown", handleMouseDown, true);
  window.addEventListener("mouseup", handleMouseUp);
  window.addEventListener("blur", unpark);

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    readClipboard().then((text) => { if (text) term.paste(text); });
  };
  container.addEventListener("contextmenu", handleContextMenu);

  const selectionDispose = term.onSelectionChange(() => {
    if (!term.getSelection()) hideBadge();
  });

  // ── OSC 52: route remote clipboard writes through our Tauri-aware path; refuse reads ──
  let clipboardAddon: ClipboardAddon | null = null;
  if (opts.osc52) {
    const provider: IClipboardProvider = {
      readText: () => "",
      writeText: (_selection, text) => writeClipboard(text),
    };
    clipboardAddon = new ClipboardAddon(undefined, provider);
    term.loadAddon(clipboardAddon);
  }

  const handleKeyEvent = (e: KeyboardEvent): boolean | null => {
    if (e.ctrlKey && e.shiftKey && e.key === "C") {
      if (e.type === "keydown") {
        const sel = term.getSelection();
        if (sel) writeClipboard(sel);
      }
      return false;
    }
    if (e.ctrlKey && e.shiftKey && e.key === "V") {
      e.preventDefault();
      if (e.type === "keydown") {
        readClipboard().then((text) => { if (text) term.paste(text); });
      }
      return false;
    }
    if (e.ctrlKey && !e.shiftKey && e.key === "c") {
      const sel = term.getSelection();
      if (sel) {
        if (e.type === "keydown") writeClipboard(sel);
        return false;
      }
      return true;
    }
    if (e.ctrlKey && !e.shiftKey && e.key === "v") {
      e.preventDefault();
      if (e.type === "keydown") {
        readClipboard().then((text) => { if (text) term.paste(text); });
      }
      return false;
    }
    return null;
  };

  return {
    handleKeyEvent,
    dispose() {
      unpark();
      container.removeEventListener("mousedown", handleMouseDown, true);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("blur", unpark);
      container.removeEventListener("contextmenu", handleContextMenu);
      selectionDispose.dispose();
      hideBadge();
      clipboardAddon?.dispose();
    },
  };
}
