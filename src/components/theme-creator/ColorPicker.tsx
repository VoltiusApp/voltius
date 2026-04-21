import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";

// ── Color math ────────────────────────────────────────────────────────────────

function hexToHsv(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  if (d !== 0) {
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [h * 360, s * 100, max * 100];
}

function hsvToHex(h: number, s: number, v: number): string {
  h /= 360; s /= 100; v /= 100;
  let r = 0, g = 0, b = 0;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }
  const toHex = (n: number) => Math.round(n * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hueColor(h: number) {
  return hsvToHex(h, 100, 100);
}

function parseColor(raw: string): string | null {
  const s = raw.trim();

  // #rrggbb or #rgb
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    const [, r, g, b] = s;
    return `#${r}${r}${g}${g}${b}${b}`;
  }

  // rrggbb or rgb (no hash)
  if (/^[0-9a-fA-F]{6}$/.test(s)) return `#${s}`;
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    const [r, g, b] = s;
    return `#${r}${r}${g}${g}${b}${b}`;
  }

  // rgb(r, g, b) — values 0-255 or 0%-100%
  const rgbMatch = s.match(/^rgba?\(\s*([\d.]+%?)\s*,\s*([\d.]+%?)\s*,\s*([\d.]+%?)[\s,\d.]*\)$/i);
  if (rgbMatch) {
    const parse = (v: string) => v.endsWith("%") ? Math.round(parseFloat(v) * 2.55) : parseInt(v);
    const r = Math.max(0, Math.min(255, parse(rgbMatch[1])));
    const g = Math.max(0, Math.min(255, parse(rgbMatch[2])));
    const b = Math.max(0, Math.min(255, parse(rgbMatch[3])));
    return `#${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${b.toString(16).padStart(2,"0")}`;
  }

  // hsl(h, s%, l%)
  const hslMatch = s.match(/^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%[\s,\d.]*\)$/i);
  if (hslMatch) {
    const h = parseFloat(hslMatch[1]) % 360;
    const sl = parseFloat(hslMatch[2]) / 100;
    const l = parseFloat(hslMatch[3]) / 100;
    const a = sl * Math.min(l, 1 - l);
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    const toHex = (n: number) => Math.round(n * 255).toString(16).padStart(2, "0");
    return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
  }

  return null;
}

// ── Picker popover ────────────────────────────────────────────────────────────

const PICKER_W = 220;
const SV_H = 160;
const SLIDER_H = 14;

function Popover({
  hsv,
  setHsv,
  hexInput,
  setHexInput,
  onClose,
  anchorRect,
}: {
  hsv: [number, number, number];
  setHsv: (fn: (prev: [number, number, number]) => [number, number, number]) => void;
  hexInput: string;
  setHexInput: (v: string) => void;
  onClose: () => void;
  anchorRect: DOMRect;
}) {
  const [h, s, v] = hsv;
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const svDragging = useRef(false);
  const hueDragging = useRef(false);

  // Position: prefer left of anchor, fall back to right
  const left = anchorRect.left - PICKER_W - 8;
  const safeLeft = left < 8 ? anchorRect.right + 8 : left;
  const top = Math.min(anchorRect.top, window.innerHeight - SV_H - SLIDER_H - 100);

  const readSv = useCallback((e: { clientX: number; clientY: number }) => {
    if (!svRef.current) return;
    const r = svRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    setHsv(([hh]) => [hh, x * 100, (1 - y) * 100]);
  }, [setHsv]);

  const readHue = useCallback((e: { clientX: number }) => {
    if (!hueRef.current) return;
    const r = hueRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    setHsv(([, ss, vv]) => [x * 360, ss, vv]);
  }, [setHsv]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (svDragging.current) readSv(e);
      if (hueDragging.current) readHue(e);
    };
    const onUp = () => {
      svDragging.current = false;
      hueDragging.current = false;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [readSv, readHue]);

  // Close on outside click
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [onClose]);

  const currentHex = hsvToHex(h, s, v);

  return createPortal(
    <div
      ref={boxRef}
      style={{
        position: "fixed",
        left: safeLeft,
        top,
        width: PICKER_W,
        zIndex: 9999,
        background: "var(--t-bg-modal)",
        border: "1px solid var(--t-border)",
        borderRadius: 8,
        padding: 12,
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {/* SV square */}
      <div
        ref={svRef}
        style={{
          width: "100%",
          height: SV_H,
          borderRadius: 4,
          position: "relative",
          cursor: "crosshair",
          background: hueColor(h),
          overflow: "hidden",
        }}
        onPointerDown={(e) => {
          svDragging.current = true;
          (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
          readSv(e);
        }}
      >
        {/* White left-to-right */}
        <div style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(to right, #fff, transparent)",
        }} />
        {/* Black top-to-bottom */}
        <div style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(to bottom, transparent, #000)",
        }} />
        {/* Thumb */}
        <div style={{
          position: "absolute",
          left: `${s}%`,
          top: `${100 - v}%`,
          transform: "translate(-50%, -50%)",
          width: 12,
          height: 12,
          borderRadius: "50%",
          border: "2px solid #fff",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.5)",
          pointerEvents: "none",
          background: currentHex,
        }} />
      </div>

      {/* Hue slider */}
      <div
        ref={hueRef}
        style={{
          width: "100%",
          height: SLIDER_H,
          borderRadius: 99,
          position: "relative",
          cursor: "ew-resize",
          background: "linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)",
        }}
        onPointerDown={(e) => {
          hueDragging.current = true;
          (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
          readHue(e);
        }}
      >
        <div style={{
          position: "absolute",
          left: `${(h / 360) * 100}%`,
          top: "50%",
          transform: "translate(-50%, -50%)",
          width: 16,
          height: 16,
          borderRadius: "50%",
          border: "2px solid #fff",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.4)",
          pointerEvents: "none",
          background: hueColor(h),
        }} />
      </div>

      {/* Hex input + swatch */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <div style={{
          width: 28,
          height: 28,
          borderRadius: 4,
          background: currentHex,
          border: "1px solid var(--t-border)",
          flexShrink: 0,
        }} />
        <input
          value={hexInput}
          onChange={(e) => {
            const val = e.target.value;
            setHexInput(val);
            const hex = parseColor(val);
            if (hex) setHsv(() => hexToHsv(hex));
          }}
          onBlur={() => setHexInput(currentHex)}
          spellCheck={false}
          style={{
            flex: 1,
            background: "var(--t-bg-input)",
            border: "1px solid var(--t-border)",
            borderRadius: 4,
            color: "var(--t-text-primary)",
            fontFamily: "monospace",
            fontSize: 12,
            padding: "4px 8px",
            outline: "none",
          }}
        />
      </div>
    </div>,
    document.body
  );
}

// ── Public component ──────────────────────────────────────────────────────────

export function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (hex: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hsv, setHsvRaw] = useState<[number, number, number]>(() => hexToHsv(value));
  const [hexInput, setHexInput] = useState(value);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const lastEmittedRef = useRef(value);

  // Sync when value changes from outside (e.g. undo/redo)
  useEffect(() => {
    if (value !== lastEmittedRef.current) {
      lastEmittedRef.current = value;
      setHsvRaw(hexToHsv(value));
      setHexInput(value);
    }
  }, [value]);

  const setHsv = useCallback(
    (fn: (prev: [number, number, number]) => [number, number, number]) => {
      setHsvRaw((prev) => {
        const next = fn(prev);
        const hex = hsvToHex(...next);
        lastEmittedRef.current = hex;
        setHexInput(hex);
        onChange(hex);
        return next;
      });
    },
    [onChange]
  );

  const handleOpen = () => {
    if (!anchorRef.current) return;
    setAnchorRect(anchorRef.current.getBoundingClientRect());
    setHsvRaw(hexToHsv(value));
    setHexInput(value);
    setOpen(true);
  };

  return (
    <>
      <button
        ref={anchorRef}
        onClick={handleOpen}
        style={{
          width: 28,
          height: 28,
          borderRadius: 4,
          background: value,
          border: "2px solid var(--t-border)",
          cursor: "pointer",
          flexShrink: 0,
          padding: 0,
        }}
        title={value}
      />
      {open && anchorRect && (
        <Popover
          hsv={hsv}
          setHsv={setHsv}
          hexInput={hexInput}
          setHexInput={setHexInput}
          onClose={() => setOpen(false)}
          anchorRect={anchorRect}
        />
      )}
    </>
  );
}
