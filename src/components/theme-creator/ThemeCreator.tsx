import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useUIStore } from "@/stores/uiStore";
import { useThemeStore } from "@/stores/themeStore";
import { BUILT_IN_THEMES } from "@/themes/presets";
import { applyThemeToDom } from "@/hooks/useApplyTheme";
import type { AppTheme, UITheme, TerminalTheme } from "@/themes/types";
import { getUiGroups, getTerminalGroups, getFieldLabels } from "./colorGroups";
import { ColorPicker } from "./ColorPicker";

// ── CSS variable inspector ────────────────────────────────────────────────────

const VAR_RE = /var\(\s*(--t-[\w-]+)/g;

function scanElement(el: Element): Set<string> {
  const vars = new Set<string>();

  // Inline styles (handles style={{ color: "var(--t-text-primary)" }})
  const inline = (el as HTMLElement).style?.cssText ?? "";
  for (const m of inline.matchAll(VAR_RE)) vars.add(m[1]);

  // Matched stylesheet rules
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (!(rule instanceof CSSStyleRule)) continue;
        try {
          if (!el.matches(rule.selectorText)) continue;
        } catch {
          continue; // invalid / unsupported selector
        }
        for (const m of rule.cssText.matchAll(VAR_RE)) vars.add(m[1]);
      }
    } catch {
      // cross-origin sheet
    }
  }

  return vars;
}

function varToField(v: string): string {
  // "--t-bg-input" → "bgInput"
  return v
    .replace("--t-", "")
    .replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function fieldToVar(field: string): string {
  // "bgInput" → "--t-bg-input"
  return "--t-" + field.replace(/([A-Z])/g, (_, c: string) => "-" + c.toLowerCase());
}

function findElementsUsingVar(varName: string): Element[] {
  const selectors: string[] = [];
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (!(rule instanceof CSSStyleRule)) continue;
        if (rule.cssText.includes(varName)) selectors.push(rule.selectorText);
      }
    } catch { /* cross-origin */ }
  }
  const matched = new Set<Element>();
  for (const sel of selectors) {
    try { document.querySelectorAll(sel).forEach((el) => matched.add(el)); } catch { /* invalid */ }
  }
  document.querySelectorAll("[style]").forEach((el) => {
    if ((el as HTMLElement).style.cssText.includes(varName)) matched.add(el);
  });
  return [...matched];
}

function findFields(el: Element): string[] {
  const found = new Set<string>();
  let node: Element | null = el;
  let depth = 0;
  while (node && node !== document.body && depth < 5) {
    for (const v of scanElement(node)) found.add(varToField(v));
    node = node.parentElement;
    depth++;
  }
  return [...found];
}

// ── Font picker ───────────────────────────────────────────────────────────────

const UI_FONT_OPTIONS = [
  { label: "Inter Variable", value: "'Inter Variable', system-ui, sans-serif" },
  { label: "System UI", value: "system-ui, sans-serif" },
  { label: "Georgia", value: "Georgia, serif" },
];

const TERMINAL_FONT_OPTIONS = [
  { label: "JetBrains Mono", value: "'JetBrains Mono', monospace" },
  { label: "Source Code Pro", value: "'Source Code Pro', monospace" },
];

function FontPicker({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { label: string; value: string }[];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const isPreset = options.some((o) => o.value === value);
  const displayLabel = options.find((o) => o.value === value)?.label ?? value.split(",")[0].replace(/'/g, "").trim();

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setCustom(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative mt-1">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); setCustom(false); }}
        className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-sm bg-(--t-bg-input) border border-(--t-border) text-(--t-text-primary) cursor-pointer"
        onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--t-border-hover)")}
        onMouseLeave={(e) => (e.currentTarget.style.borderColor = open ? "var(--t-accent)" : "var(--t-border)")}
        style={{ borderColor: open ? "var(--t-accent)" : undefined }}
      >
        <span style={{ fontFamily: value, fontSize: 13 }}>{displayLabel}</span>
        <Icon icon={open ? "lucide:chevron-up" : "lucide:chevron-down"} width={12} className="text-(--t-text-dim) shrink-0" />
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute left-0 right-0 z-50 mt-1 rounded-md bg-(--t-bg-modal) overflow-hidden"
          style={{ boxShadow: "var(--t-ring), var(--t-elev-2)" }}
        >
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false); setCustom(false); }}
              className="w-full flex items-center justify-between px-3 py-2 text-left cursor-pointer transition-colors"
              style={{ background: value === opt.value ? "color-mix(in srgb, var(--t-accent) 12%, transparent)" : "transparent" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-elevated)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = value === opt.value ? "color-mix(in srgb, var(--t-accent) 12%, transparent)" : "transparent"; }}
            >
              <span style={{ fontFamily: opt.value, fontSize: 13, color: "var(--t-text-primary)" }}>{opt.label}</span>
              {value === opt.value && <Icon icon="lucide:check" width={12} className="text-(--t-accent) shrink-0" />}
            </button>
          ))}

          {/* Custom divider */}
          <div className="border-t border-(--t-border)" />
          {!custom ? (
            <button
              type="button"
              onClick={() => setCustom(true)}
              className="w-full px-3 py-2 text-left text-xs text-(--t-text-muted) cursor-pointer transition-colors"
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-primary)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-muted)"; }}
            >
              {t("themeCreator.font.customLabel")}
            </button>
          ) : (
            <div className="px-3 py-2">
              <input
                autoFocus
                defaultValue={isPreset ? "" : value}
                placeholder={t("themeCreator.font.customPlaceholder")}
                className="w-full px-2 py-1 rounded-sm text-xs outline-hidden font-mono bg-(--t-bg-input) border border-(--t-accent) text-(--t-text-primary)"
                onKeyDown={(e) => {
                  if (e.key === "Enter") { onChange(e.currentTarget.value); setOpen(false); setCustom(false); }
                  if (e.key === "Escape") { setCustom(false); }
                }}
              />
              <p className="text-[10px] text-(--t-text-dim) mt-1">{t("themeCreator.font.customHint")}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Var search overlay ────────────────────────────────────────────────────────

function VarSearchOverlay({ varName, onClose }: { varName: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [rects, setRects] = useState<DOMRect[]>([]);

  useEffect(() => {
    const els = findElementsUsingVar(varName);
    setRects(els.map((el) => el.getBoundingClientRect()));
  }, [varName]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return createPortal(
    <>
      <div style={{ position: "fixed", inset: 0, zIndex: 9990, background: "rgba(0,0,0,0.3)" }} onClick={onClose} />
      {rects.map((rect, i) => (
        <div key={i} style={{
          position: "fixed",
          left: rect.left - 2, top: rect.top - 2,
          width: rect.width + 4, height: rect.height + 4,
          zIndex: 9991, outline: "2px solid var(--t-accent)",
          borderRadius: 3, pointerEvents: "none",
          background: "color-mix(in srgb, var(--t-accent) 8%, transparent)",
        }} />
      ))}
      <div style={{
        position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
        zIndex: 9992, background: "var(--t-bg-modal)", border: "1px solid var(--t-border)",
        borderRadius: 6, padding: "6px 14px", fontSize: 12,
        color: "var(--t-text-secondary)", pointerEvents: "none", whiteSpace: "nowrap",
      }}>
        {t("themeCreator.varSearch.usage", { count: rects.length })}{" "}
        <code style={{ color: "var(--t-accent)" }}>{varName}</code>
        {" — "}<kbd style={{ color: "var(--t-text-primary)" }}>{t("themeCreator.escKey")}</kbd> {t("themeCreator.varSearch.suffix")}
      </div>
    </>,
    document.body
  );
}

// ── ColorEditor ───────────────────────────────────────────────────────────────

function ColorEditor({
  draft,
  setDraft,
  pickedFields,
}: {
  draft: AppTheme;
  setDraft: React.Dispatch<React.SetStateAction<AppTheme>>;
  pickedFields: Set<string>;
}) {
  const { t } = useTranslation();
  const uiGroups = getUiGroups(t);
  const terminalGroups = getTerminalGroups(t);
  const fieldLabels = getFieldLabels(t);

  const setUiColor = (field: keyof UITheme, value: string) =>
    setDraft((d) => ({ ...d, ui: { ...d.ui, [field]: value } }));
  const setTermColor = (field: keyof TerminalTheme, value: string) =>
    setDraft((d) => ({ ...d, terminal: { ...d.terminal, [field]: value } }));

  const [searchVar, setSearchVar] = useState<string | null>(null);

  const ui = draft.ui as unknown as Record<string, string>;
  const term = draft.terminal as unknown as Record<string, string>;
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll to first match when pickedFields changes
  useEffect(() => {
    if (!pickedFields.size || !scrollRef.current) return;
    const first = scrollRef.current.querySelector<HTMLElement>("[data-picked='true']");
    first?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [pickedFields]);

  const rowStyle = (field: string): React.CSSProperties =>
    pickedFields.has(field)
      ? {
          borderRadius: 4,
          boxShadow: "inset 0 0 0 1px var(--t-accent)",
          background: "color-mix(in srgb, var(--t-accent) 12%, transparent)",
          padding: "2px 4px",
          margin: "0 -4px",
        }
      : { padding: "2px 4px", margin: "0 -4px" };

  return (
    <>
    {searchVar && <VarSearchOverlay varName={searchVar} onClose={() => setSearchVar(null)} />}
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-5">
      {/* General */}
      <div className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-widest text-(--t-text-dim)">{t("themeCreator.editor.general")}</p>
        <label className="block">
          <span className="text-xs text-(--t-text-muted)">{t("themeCreator.editor.name")}</span>
          <input
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            className="form-input w-full mt-1 px-2.5 py-1.5 rounded-md text-sm outline-hidden bg-(--t-bg-input) border border-(--t-border) text-(--t-text-primary)"
          />
        </label>
      </div>

      {/* App Font */}
      <div className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-widest text-(--t-text-dim)">{t("themeCreator.editor.appFont")}</p>
        <div>
          <span className="text-xs text-(--t-text-muted)">{t("themeCreator.editor.family")}</span>
          <FontPicker
            value={draft.uiFontFamily}
            onChange={(v) => setDraft((d) => ({ ...d, uiFontFamily: v }))}
            options={UI_FONT_OPTIONS}
          />
        </div>
        <label className="block">
          <span className="text-xs text-(--t-text-muted)">{t("themeCreator.editor.sizePx")}</span>
          <input
            type="number" min={10} max={20} value={draft.uiFontSize}
            onChange={(e) => setDraft((d) => ({ ...d, uiFontSize: Number(e.target.value) }))}
            className="form-input w-full mt-1 px-2.5 py-1.5 rounded-md text-sm outline-hidden bg-(--t-bg-input) border border-(--t-border) text-(--t-text-primary)"
          />
        </label>
      </div>

      {uiGroups.map((group) => (
        <div key={group.label} className="space-y-1.5">
          <p className="text-xs font-bold uppercase tracking-widest text-(--t-text-dim)">{group.label}</p>
          {group.fields.map((field) => (
            <div
              key={field}
              data-field={field}
              data-picked={pickedFields.has(field as string) ? "true" : undefined}
              className="flex items-center gap-2 transition-all duration-300"
              style={rowStyle(field as string)}
            >
              <ColorPicker
                value={ui[field as string]}
                onChange={(hex) => setUiColor(field, hex)}
              />
              <span className="text-xs flex-1 text-(--t-text-secondary)">{fieldLabels[field] ?? field}</span>
              <code className="text-xs font-mono text-(--t-text-muted)">{ui[field as string]}</code>
              <button
                onClick={() => setSearchVar(searchVar === fieldToVar(field as string) ? null : fieldToVar(field as string))}
                title={t("themeCreator.editor.highlightUsing", { varName: fieldToVar(field as string) })}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 18, height: 18, borderRadius: 4, border: "1px solid",
                  cursor: "pointer", flexShrink: 0,
                  borderColor: searchVar === fieldToVar(field as string) ? "var(--t-accent)" : "transparent",
                  background: searchVar === fieldToVar(field as string) ? "color-mix(in srgb, var(--t-accent) 18%, transparent)" : "transparent",
                  color: searchVar === fieldToVar(field as string) ? "var(--t-accent)" : "var(--t-text-dim)",
                }}
                onMouseEnter={(e) => { if (searchVar !== fieldToVar(field as string)) (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-muted)"; }}
                onMouseLeave={(e) => { if (searchVar !== fieldToVar(field as string)) (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-dim)"; }}
              >
                <Icon icon="lucide:search" width={10} />
              </button>
            </div>
          ))}
        </div>
      ))}

      {/* Terminal Font */}
      <div className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-widest text-(--t-text-dim)">{t("themeCreator.editor.terminalFont")}</p>
        <div>
          <span className="text-xs text-(--t-text-muted)">{t("themeCreator.editor.family")}</span>
          <FontPicker
            value={draft.terminalFontFamily}
            onChange={(v) => setDraft((d) => ({ ...d, terminalFontFamily: v }))}
            options={TERMINAL_FONT_OPTIONS}
          />
        </div>
        <label className="block">
          <span className="text-xs text-(--t-text-muted)">{t("themeCreator.editor.sizePx")}</span>
          <input
            type="number" min={8} max={24} value={draft.terminalFontSize}
            onChange={(e) => setDraft((d) => ({ ...d, terminalFontSize: Number(e.target.value) }))}
            className="form-input w-full mt-1 px-2.5 py-1.5 rounded-md text-sm outline-hidden bg-(--t-bg-input) border border-(--t-border) text-(--t-text-primary)"
          />
        </label>
      </div>

      {terminalGroups.map((group) => (
        <div key={group.label} className="space-y-1.5">
          <p className="text-xs font-bold uppercase tracking-widest text-(--t-text-dim)">{group.label}</p>
          {group.fields.map((field) => (
            <div
              key={field}
              data-field={field}
              data-picked={pickedFields.has(field as string) ? "true" : undefined}
              className="flex items-center gap-2 transition-all duration-300"
              style={rowStyle(field as string)}
            >
              <ColorPicker
                value={term[field as string].startsWith("#") && term[field as string].length >= 7
                  ? term[field as string].slice(0, 7) : "#000000"}
                onChange={(hex) => setTermColor(field, hex)}
              />
              <span className="text-xs flex-1 text-(--t-text-secondary)">{fieldLabels[field] ?? field}</span>
              <code className="text-xs font-mono text-(--t-text-muted)">{term[field as string].slice(0, 7)}</code>
            </div>
          ))}
        </div>
      ))}
    </div>
    </>
  );
}

// ── Pick-mode overlay ─────────────────────────────────────────────────────────

function PickOverlay({ rect }: { rect: DOMRect | null }) {
  const { t } = useTranslation();
  if (!rect) return null;
  return createPortal(
    <>
      {/* Dim behind the highlight (cutout effect via box-shadow on the highlight div) */}
      {/* Cutout highlight over hovered element */}
      <div style={{
        position: "fixed",
        left: rect.left - 2,
        top: rect.top - 2,
        width: rect.width + 4,
        height: rect.height + 4,
        zIndex: 9991,
        outline: "2px solid var(--t-accent)",
        borderRadius: 3,
        boxShadow: "0 0 0 9999px rgba(0,0,0,0.25)",
        pointerEvents: "none",
      }} />
      {/* Crosshair cursor hint */}
      <div style={{
        position: "fixed", bottom: 24, left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9992,
        background: "var(--t-bg-modal)",
        border: "1px solid var(--t-border)",
        borderRadius: 6,
        padding: "6px 14px",
        fontSize: 12,
        color: "var(--t-text-secondary)",
        pointerEvents: "none",
      }}>
        {t("themeCreator.pickOverlay.prefix")} <kbd style={{ color: "var(--t-text-primary)" }}>{t("themeCreator.escKey")}</kbd> {t("themeCreator.pickOverlay.suffix")}
      </div>
    </>,
    document.body
  );
}

// ── ThemeCreator ──────────────────────────────────────────────────────────────

export default function ThemeCreator() {
  const { t } = useTranslation();
  const { themeCreatorOpen, themeCreatorEditId, closeThemeCreator } = useUIStore();
  const { getActiveTheme, saveCustomTheme, setTheme, customThemes } = useThemeStore();

  const panelRef = useRef<HTMLDivElement>(null);
  const [restoreThemeId, setRestoreThemeId] = useState<string | null>(null);
  const [draft, setDraftRaw] = useState<AppTheme>(() => ({
    ...JSON.parse(JSON.stringify(getActiveTheme())),
    id: `custom-${Date.now()}`,
    name: "My Theme",
    builtIn: false,
  }));

  // Undo/redo history
  const historyRef = useRef<AppTheme[]>([]);
  const historyIndexRef = useRef(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setDraft: React.Dispatch<React.SetStateAction<AppTheme>> = useCallback((updater) => {
    setDraftRaw((prev) => {
      const next = typeof updater === "function" ? (updater as (p: AppTheme) => AppTheme)(prev) : updater;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const truncated = historyRef.current.slice(0, historyIndexRef.current + 1);
        truncated.push(JSON.parse(JSON.stringify(next)));
        historyRef.current = truncated;
        historyIndexRef.current = truncated.length - 1;
      }, 400);
      return next;
    });
  }, []);

  const restoreDraft = useCallback((state: AppTheme) => {
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
    setDraftRaw(state);
  }, []);

  const undo = useCallback(() => {
    if (historyIndexRef.current > 0) {
      historyIndexRef.current -= 1;
      restoreDraft(JSON.parse(JSON.stringify(historyRef.current[historyIndexRef.current])));
    }
  }, [restoreDraft]);

  const redo = useCallback(() => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      historyIndexRef.current += 1;
      restoreDraft(JSON.parse(JSON.stringify(historyRef.current[historyIndexRef.current])));
    }
  }, [restoreDraft]);

  // Pick mode
  const [pickMode, setPickMode] = useState(false);
  const [hoverRect, setHoverRect] = useState<DOMRect | null>(null);
  const [pickedFields, setPickedFields] = useState<Set<string>>(new Set());

  const initHistory = useCallback((initialDraft: AppTheme) => {
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
    historyRef.current = [JSON.parse(JSON.stringify(initialDraft))];
    historyIndexRef.current = 0;
  }, []);

  useEffect(() => {
    if (!themeCreatorOpen) return;
    const active = getActiveTheme();
    setRestoreThemeId(active.id);

    if (themeCreatorEditId) {
      const existing = [...BUILT_IN_THEMES, ...customThemes].find((t) => t.id === themeCreatorEditId);
      if (existing) {
        const d = JSON.parse(JSON.stringify(existing));
        setDraftRaw(d);
        initHistory(d);
        return;
      }
    }
    const d: AppTheme = {
      ...JSON.parse(JSON.stringify(active)),
      id: `custom-${Date.now()}`,
      name: "My Theme",
      builtIn: false,
    };
    setDraftRaw(d);
    initHistory(d);
  }, [themeCreatorOpen, themeCreatorEditId, getActiveTheme, customThemes, initHistory]);

  useEffect(() => {
    if (themeCreatorOpen) applyThemeToDom(draft);
  }, [themeCreatorOpen, draft]);

  // Pick mode: intercept hover + click on document
  useEffect(() => {
    if (!pickMode) return;
    document.body.style.cursor = "crosshair";

    const onOver = (e: MouseEvent) => {
      setHoverRect((e.target as Element).getBoundingClientRect());
    };

    // Intercept mousedown to prevent appWindow.startDragging() on the titlebar,
    // which would consume the click event before our listener sees it.
    const onMouseDown = (e: MouseEvent) => {
      e.stopPropagation();
    };

    const onClick = (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const fields = findFields(e.target as Element);
      setPickedFields(new Set(fields));
      setTimeout(() => setPickedFields(new Set()), 3000);
      setPickMode(false);
      setHoverRect(null);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setPickMode(false); setHoverRect(null); }
    };

    document.addEventListener("mouseover", onOver, true);
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.body.style.cursor = "";
      document.removeEventListener("mouseover", onOver, true);
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [pickMode]);

  const handleSave = useCallback(() => {
    const themed = draft.name.trim() ? draft : { ...draft, name: "My Theme" };
    saveCustomTheme(themed);
    setTheme(themed.id);
    closeThemeCreator();
  }, [draft, saveCustomTheme, setTheme, closeThemeCreator]);

  const handleCancel = useCallback(() => {
    if (restoreThemeId) {
      const all = [...BUILT_IN_THEMES, ...customThemes];
      const original = all.find((t) => t.id === restoreThemeId) ?? BUILT_IN_THEMES[0];
      applyThemeToDom(original);
    }
    closeThemeCreator();
  }, [restoreThemeId, customThemes, closeThemeCreator]);

  useEffect(() => {
    if (!themeCreatorOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pickMode) { handleCancel(); return; }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "z") { e.preventDefault(); undo(); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.shiftKey && e.key === "z"))) { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [themeCreatorOpen, handleCancel, pickMode, undo, redo]);

  if (!themeCreatorOpen) return null;

  return (
    <>
      {pickMode && <PickOverlay rect={hoverRect} />}

      <div
        ref={panelRef}
        className="fixed right-0 top-0 bottom-0 z-200 flex flex-col border-l border-(--t-border) bg-(--t-bg-modal)"
        style={{
          width: 320,
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
          paddingRight: "env(safe-area-inset-right)",
        }}
      >
        {/* Panel header */}
        <div className="flex items-center gap-2 px-4 py-3 shrink-0 border-b border-(--t-border)">
          <span className="text-sm font-medium flex-1 text-(--t-text-bright)">
            {themeCreatorEditId ? t("themeCreator.header.editTheme") : t("themeCreator.header.newTheme")}
          </span>

          {/* Pipette / pick button */}
          <button
            onClick={() => setPickMode((m) => !m)}
            title={t("themeCreator.header.pickTooltip")}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 28, height: 28, borderRadius: 6, border: "1px solid",
              cursor: "pointer", transition: "background 0.15s, color 0.15s",
              borderColor: pickMode ? "var(--t-accent)" : "var(--t-border)",
              background: pickMode ? "color-mix(in srgb, var(--t-accent) 18%, transparent)" : "var(--t-bg-elevated)",
              color: pickMode ? "var(--t-accent)" : "var(--t-text-secondary)",
            }}
          >
            <Icon icon="lucide:pipette" width={14} />
          </button>

          <button
            onClick={handleCancel}
            className="btn btn-secondary px-3 py-1 rounded-md text-xs font-medium"
          >
            {t("common.action.cancel")}
          </button>
          <button
            onClick={handleSave}
            className="btn btn-primary px-3 py-1 rounded-md text-xs font-medium"
          >
            {t("common.action.save")}
          </button>
        </div>

        <ColorEditor draft={draft} setDraft={setDraft} pickedFields={pickedFields} />
      </div>
    </>
  );
}
