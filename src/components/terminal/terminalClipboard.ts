import type { Terminal } from "@xterm/xterm";
import { ClipboardAddon, type IClipboardProvider } from "@xterm/addon-clipboard";
import { writeClipboard, readClipboard } from "@/utils/clipboard";
import { getToggle } from "@/stores/toggleSettingsStore";
import { logFailure } from "@/lib/logger";
import { primaryOnly } from "@/utils/primaryModifier";
import { findPane } from "./tmuxPanes";
import { createPaneSelection, type Cell } from "./paneSelection";

const MOUSE_MOVE = 32;

export interface TerminalClipboardHandle {
  /** Returns false to consume the event, true to let xterm process it,
   *  or null when the event is not a clipboard shortcut. */
  handleKeyEvent(e: KeyboardEvent): boolean | null;
  /** The selected text, whether xterm's own selection or one held to a tmux pane. */
  selectionText(): string;
  dispose(): void;
}

export interface TerminalClipboardOptions {
  /** Enable OSC 52: let the remote program write the local clipboard.
   *  Reads (paste-requests) are always refused. Off by default. */
  osc52?: boolean;
  /** Called by a paste whose clipboard holds no text, e.g. a screenshot. */
  pasteImage?: () => Promise<void>;
}

/**
 * Wire the full terminal clipboard behavior onto a terminal + its container:
 * copy-on-select (with feedback badge), smart Ctrl+C / Ctrl+Shift+C, paste
 * (Ctrl+V / Ctrl+Shift+V / right-click, text or `pasteImage`), and optionally OSC 52.
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
      coreService?: { triggerDataEvent(data: string, wasUserInput?: boolean): void };
      coreMouseService?: { activeProtocol: string; triggerMouseEvent(e: { action: number; ctrl?: boolean }): boolean };
      _selectionService?: { disable(): void; _enabled: boolean };
    };
  })._core;
  const mouseService = core?.coreMouseService;

  // xterm clears the selection on any user input, motion reports included, so an
  // app tracking every motion (tmux, Claude Code) wipes it as soon as the mouse moves.
  const coreService = core?.coreService;
  const triggerMouseEvent = mouseService?.triggerMouseEvent;
  const triggerDataEvent = coreService?.triggerDataEvent;
  let motionReport = false;
  // tmux binds no Ctrl+drag, so a Ctrl drag handed to the app arrives as a plain one.
  let ctrlHandoff = false;
  if (mouseService && coreService && triggerMouseEvent && triggerDataEvent) {
    mouseService.triggerMouseEvent = (ev) => {
      motionReport = ev.action === MOUSE_MOVE;
      const report = ctrlHandoff ? { ...ev, ctrl: false } : ev;
      try { return triggerMouseEvent.call(mouseService, report); } finally { motionReport = false; }
    };
    coreService.triggerDataEvent = (data, wasUserInput) =>
      triggerDataEvent.call(coreService, data, !!wasUserInput && !motionReport);
  }
  const restoreReporting = () => {
    if (mouseService && triggerMouseEvent) mouseService.triggerMouseEvent = triggerMouseEvent;
    if (coreService && triggerDataEvent) coreService.triggerDataEvent = triggerDataEvent;
  };

  let parkedProtocol: string | null = null;
  let pressed: MouseEvent | null = null;
  let replaying = false;
  let paneDrag = false;
  const paneSelection = createPaneSelection(term);
  const selectionText = () => paneSelection.text() || term.getSelection();

  const appHoldsMouse = () => !!mouseService && term.modes.mouseTrackingMode !== "none";
  const dragSelectsText = () => appHoldsMouse() && getToggle("drag-selects-text");

  const screenRect = () => (term.element?.querySelector(".xterm-screen") ?? container).getBoundingClientRect();
  const cellAt = (e: MouseEvent): Cell | null => {
    const r = screenRect();
    if (!r.width || !r.height) return null;
    const clampTo = (v: number, n: number) => Math.min(Math.max(Math.floor(v), 0), n - 1);
    return {
      col: clampTo(((e.clientX - r.left) / r.width) * term.cols, term.cols),
      row: clampTo(((e.clientY - r.top) / r.height) * term.rows, term.rows),
    };
  };

  // Single and triple clicks inside a split tmux window select within that pane.
  const paneUnder = (e: MouseEvent) => {
    if (e.detail === 2 || term.buffer.active.type !== "alternate") return null;
    if (appHoldsMouse() && !getToggle("drag-selects-text")) return null;
    const at = cellAt(e);
    const pane = at && findPane(term.buffer.active, term.cols, term.rows, at.col, at.row);
    return pane && at ? { pane, at } : null;
  };

  const setNativeSelection = (on: boolean) => {
    const selection = core?._selectionService;
    if (selection) selection._enabled = on;
  };

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

  // The app was skipped on press, so it gets the press now: with its release for
  // a click that never became a drag, alone for a drag it takes over.
  const replayToApp = (src: MouseEvent, withRelease: boolean) => {
    const target = src.target as HTMLElement | null;
    if (!target) return;
    replaying = true;
    target.dispatchEvent(cloneMouse("mousedown", src));
    if (withRelease) document.dispatchEvent(cloneMouse("mouseup", src));
    replaying = false;
  };

  // The alternate screen has no scrollback here (tmux keeps it), so a drag past
  // its edge goes to the app, which scrolls and selects from the same press.
  const handleMouseMove = (e: MouseEvent) => {
    const press = pressed;
    if (!press || replaying || !(e.buttons & 1) || term.buffer.active.type !== "alternate") return;
    const { top, bottom } = screenRect();
    if (e.clientY >= top && e.clientY < bottom) return;
    pressed = null;
    term.clearSelection();
    paneSelection.clear();
    unpark();
    replayToApp(press, false);
  };
  const handlePaneDrag = (e: MouseEvent) => {
    if (!paneDrag || !(e.buttons & 1)) return;
    const at = cellAt(e);
    if (at) paneSelection.extend(at);
  };

  // A drag that starts in the terminal often ends outside it (window padding,
  // another pane, past the window edge). Arm on mousedown inside the container
  // and resolve on the window so those releases still copy.
  let dragging = false;
  const handleMouseDown = (e: MouseEvent) => {
    if (replaying || e.button !== 0) return;
    dragging = true;
    paneSelection.clear();
    if (e.ctrlKey && dragSelectsText()) ctrlHandoff = true;
    if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
    const inPane = paneUnder(e);
    if (!inPane && !dragSelectsText()) return;
    // Parking at NONE before xterm's own listeners run re-enables its
    // selection; the app gets the mouse back on release.
    if (mouseService && appHoldsMouse()) {
      if (parkedProtocol === null) parkedProtocol = mouseService.activeProtocol;
      mouseService.activeProtocol = "NONE";
      pressed = e;
    }
    if (inPane) {
      term.clearSelection();
      setNativeSelection(false);
      paneDrag = true;
      paneSelection.start(inPane.pane, inPane.at, e.detail === 3);
    }
  };
  const handleMouseUp = (e: MouseEvent) => {
    if (replaying) return;
    const press = pressed;
    pressed = null;
    ctrlHandoff = false;
    unpark();
    if (paneDrag) setNativeSelection(!appHoldsMouse());
    paneDrag = false;
    if (!press && !dragging) return;
    const sel = selectionText();
    if (press) {
      const moved = Math.abs(e.clientX - press.clientX) + Math.abs(e.clientY - press.clientY) >= 4;
      if (!moved && !sel) replayToApp(press, true);
    }
    if (!dragging) return;
    dragging = false;
    // Copy-on-select is opt-out: when the "Select to Copy" toggle is off, a
    // selection must NOT touch the clipboard (#50). Explicit Ctrl+Shift+C still
    // copies regardless.
    if (!getToggle("select-to-copy") || !sel) return;
    writeClipboard(sel).then(
      () => showBadge(e.clientX, e.clientY),
      logFailure("copy-on-select"),
    );
  };
  container.addEventListener("mousedown", handleMouseDown, true);
  window.addEventListener("mousemove", handleMouseMove, true);
  window.addEventListener("mousemove", handlePaneDrag);
  window.addEventListener("mouseup", handleMouseUp);
  const handleBlur = () => {
    ctrlHandoff = false;
    unpark();
  };
  window.addEventListener("blur", handleBlur);

  const pasteClipboard = async () => {
    const text = await readClipboard().catch(() => "");
    if (text) term.paste(text);
    else await opts.pasteImage?.();
  };

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    void pasteClipboard();
  };
  container.addEventListener("contextmenu", handleContextMenu);

  const selectionDispose = term.onSelectionChange(() => {
    if (term.getSelection()) paneSelection.clear();
    else hideBadge();
  });
  const paneSelectionResets = [
    term.onKey(() => paneSelection.clear()),
    term.onResize(() => paneSelection.clear()),
    term.buffer.onBufferChange(() => paneSelection.clear()),
  ];

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
    if (!primaryOnly(e) || e.altKey) return null;
    const key = e.key.toLowerCase();
    if (key === "c") {
      const sel = selectionText();
      if (sel) {
        if (e.type === "keydown") writeClipboard(sel);
        return false;
      }
      return !e.shiftKey;
    }
    if (key === "v") {
      e.preventDefault();
      if (e.type === "keydown") void pasteClipboard();
      return false;
    }
    return null;
  };

  return {
    handleKeyEvent,
    selectionText,
    dispose() {
      unpark();
      restoreReporting();
      container.removeEventListener("mousedown", handleMouseDown, true);
      window.removeEventListener("mousemove", handleMouseMove, true);
      window.removeEventListener("mousemove", handlePaneDrag);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("blur", handleBlur);
      container.removeEventListener("contextmenu", handleContextMenu);
      selectionDispose.dispose();
      for (const d of paneSelectionResets) d.dispose();
      paneSelection.clear();
      hideBadge();
      clipboardAddon?.dispose();
    },
  };
}
