import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";

const CHECKERBOARD = `url('data:image/svg+xml;charset=utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="8" height="8" fill="%23e6e6e6"/><rect x="8" width="8" height="8" fill="%23ffffff"/><rect y="8" width="8" height="8" fill="%23ffffff"/><rect x="8" y="8" width="8" height="8" fill="%23e6e6e6"/></svg>')`;

// ── Color math ────────────────────────────────────────────────────────────────

function hexToHsva(hex: string): [number, number, number, number] {
  if (!hex.startsWith("#")) hex = "#" + hex;
  let r = 0, g = 0, b = 0, a = 1;

  if (hex.length === 5) {
    r = parseInt(hex.slice(1, 2).repeat(2), 16) / 255;
    g = parseInt(hex.slice(2, 3).repeat(2), 16) / 255;
    b = parseInt(hex.slice(3, 4).repeat(2), 16) / 255;
    a = parseInt(hex.slice(4, 5).repeat(2), 16) / 255;
  } else if (hex.length === 4) {
    r = parseInt(hex.slice(1, 2).repeat(2), 16) / 255;
    g = parseInt(hex.slice(2, 3).repeat(2), 16) / 255;
    b = parseInt(hex.slice(3, 4).repeat(2), 16) / 255;
  } else if (hex.length === 9) {
    r = parseInt(hex.slice(1, 3), 16) / 255;
    g = parseInt(hex.slice(3, 5), 16) / 255;
    b = parseInt(hex.slice(5, 7), 16) / 255;
    a = parseInt(hex.slice(7, 9), 16) / 255;
  } else {
    r = parseInt(hex.slice(1, 3), 16) / 255;
    g = parseInt(hex.slice(3, 5), 16) / 255;
    b = parseInt(hex.slice(5, 7), 16) / 255;
  }

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
  return [h * 360, s * 100, max * 100, a];
}

function hsvaToHex(h: number, s: number, v: number, a: number): string {
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
  const base = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  return a < 1 ? base + toHex(a) : base;
}

function parseColor(raw: string): string | null {
  const s = raw.trim();

  // Hex (3, 4, 6, or 8 digits)
  if (/^#?([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s)) {
    let hex = s.startsWith("#") ? s.slice(1) : s;
    if (hex.length === 3 || hex.length === 4) {
      hex = hex.split("").map((c) => c + c).join("");
    }
    return "#" + hex;
  }

  // rgb/rgba
  const rgbMatch = s.match(/^rgba?\(\s*([\d.]+%?)\s*,\s*([\d.]+%?)\s*,\s*([\d.]+%?)(?:\s*,\s*([\d.]+%?))?\s*\)$/i);
  if (rgbMatch) {
    const parse = (v: string) => v.endsWith("%") ? Math.round(parseFloat(v) * 2.55) : parseInt(v);
    const r = Math.max(0, Math.min(255, parse(rgbMatch[1])));
    const g = Math.max(0, Math.min(255, parse(rgbMatch[2])));
    const b = Math.max(0, Math.min(255, parse(rgbMatch[3])));
    let a = 255;
    if (rgbMatch[4] !== undefined) {
      a = rgbMatch[4].endsWith("%")
        ? Math.round(parseFloat(rgbMatch[4]) * 2.55)
        : Math.round(parseFloat(rgbMatch[4]) * 255);
    }
    const toHex = (n: number) => n.toString(16).padStart(2, "0");
    let hex = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    if (a < 255) hex += toHex(a);
    return hex;
  }

  // hsl/hsla
  const hslMatch = s.match(/^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%(?:\s*,\s*([\d.]+%?))?\s*\)$/i);
  if (hslMatch) {
    const h = parseFloat(hslMatch[1]) % 360;
    const sl = parseFloat(hslMatch[2]) / 100;
    const l = parseFloat(hslMatch[3]) / 100;
    let alpha = 1;
    if (hslMatch[4] !== undefined) {
      alpha = hslMatch[4].endsWith("%")
        ? parseFloat(hslMatch[4]) / 100
        : parseFloat(hslMatch[4]);
    }
    const a = sl * Math.min(l, 1 - l);
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    const toHex = (n: number) => Math.round(n * 255).toString(16).padStart(2, "0");
    let hex = `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
    if (alpha < 1) hex += toHex(alpha);
    return hex;
  }

  return null;
}

// ── Picker popover ────────────────────────────────────────────────────────────

const PICKER_W = 220;
const SV_H = 160;
const SLIDER_H = 14;

function Popover({
  hsva,
  setHsva,
  hexInput,
  setHexInput,
  onClose,
  anchorRect,
}: {
  hsva: [number, number, number, number];
  setHsva: (fn: (prev: [number, number, number, number]) => [number, number, number, number]) => void;
  hexInput: string;
  setHexInput: (v: string) => void;
  onClose: () => void;
  anchorRect: DOMRect;
}) {
  const [h, s, v, a] = hsva;
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const alphaRef = useRef<HTMLDivElement>(null);
  const svDragging = useRef(false);
  const hueDragging = useRef(false);
  const alphaDragging = useRef(false);

  // Position: prefer left of anchor, fall back to right
  const left = anchorRect.left - PICKER_W - 8;
  const safeLeft = left < 8 ? anchorRect.right + 8 : left;
  const top = Math.min(anchorRect.top, window.innerHeight - 280);

  const readSv = useCallback((e: { clientX: number; clientY: number }) => {
    if (!svRef.current) return;
    const r = svRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    setHsva(([hh, , , aa]) => [hh, x * 100, (1 - y) * 100, aa]);
  }, [setHsva]);

  const readHue = useCallback((e: { clientX: number }) => {
    if (!hueRef.current) return;
    const r = hueRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    setHsva(([, ss, vv, aa]) => [x * 360, ss, vv, aa]);
  }, [setHsva]);

  const readAlpha = useCallback((e: { clientX: number }) => {
    if (!alphaRef.current) return;
    const r = alphaRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    setHsva(([hh, ss, vv, _]) => [hh, ss, vv, x]);
  }, [setHsva]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (svDragging.current) readSv(e);
      if (hueDragging.current) readHue(e);
      if (alphaDragging.current) readAlpha(e);
    };
    const onUp = () => {
      svDragging.current = false;
      hueDragging.current = false;
      alphaDragging.current = false;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [readSv, readHue, readAlpha]);

  // Close on outside click
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [onClose]);

  const currentHex = hsvaToHex(h, s, v, a);
  const opaqueHex = hsvaToHex(h, s, v, 1);
  const hueHex = hsvaToHex(h, 100, 100, 1);

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
        borderRadius: 8,
        padding: 12,
        boxShadow: "var(--t-ring), var(--t-elev-2)",
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
          background: hueHex,
          overflow: "hidden",
        }}
        onPointerDown={(e) => {
          svDragging.current = true;
          (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
          readSv(e);
        }}
      >
        <div style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(to right, #fff, rgba(255,255,255,0))",
        }} />
        <div style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(to bottom, rgba(0,0,0,0), #000)",
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
          background: opaqueHex,
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
          background: hueHex,
        }} />
      </div>

      {/* Alpha slider */}
      <div
        ref={alphaRef}
        style={{
          width: "100%",
          height: SLIDER_H,
          borderRadius: 99,
          position: "relative",
          cursor: "ew-resize",
          backgroundImage: CHECKERBOARD,
        }}
        onPointerDown={(e) => {
          alphaDragging.current = true;
          (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
          readAlpha(e);
        }}
      >
        <div style={{
          position: "absolute", inset: 0, borderRadius: 99,
          background: `linear-gradient(to right, transparent, ${opaqueHex})`,
          pointerEvents: "none",
        }} />
        <div style={{
          position: "absolute",
          left: `${a * 100}%`,
          top: "50%",
          transform: "translate(-50%, -50%)",
          width: 16,
          height: 16,
          borderRadius: "50%",
          border: "2px solid #fff",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.4)",
          pointerEvents: "none",
          backgroundImage: CHECKERBOARD,
        }}>
          <div style={{ width: "100%", height: "100%", borderRadius: "50%", background: currentHex }} />
        </div>
      </div>

      {/* Hex input + swatch */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <div style={{
          width: 28,
          height: 28,
          borderRadius: 4,
          backgroundImage: CHECKERBOARD,
          border: "1px solid var(--t-border)",
          flexShrink: 0,
        }}>
          <div style={{ width: "100%", height: "100%", borderRadius: "inherit", background: currentHex }} />
        </div>
        <input
          value={hexInput}
          onChange={(e) => {
            const val = e.target.value;
            setHexInput(val);
            const hex = parseColor(val);
            if (hex) setHsva(() => hexToHsva(hex));
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
  const [hsva, setHsvaRaw] = useState<[number, number, number, number]>(() => hexToHsva(value));
  const [hexInput, setHexInput] = useState(value);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const lastEmittedRef = useRef(value);

  // Sync when value changes from outside (e.g. undo/redo)
  useEffect(() => {
    if (value !== lastEmittedRef.current) {
      lastEmittedRef.current = value;
      setHsvaRaw(hexToHsva(value));
      setHexInput(value);
    }
  }, [value]);

  const setHsva = useCallback(
    (fn: (prev: [number, number, number, number]) => [number, number, number, number]) => {
      setHsvaRaw((prev) => {
        const next = fn(prev);
        const hex = hsvaToHex(...next);
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
    setHsvaRaw(hexToHsva(value));
    setHexInput(value);
    setOpen(true);
  };

  return (
    <>
      <button
        ref={anchorRef}
        onClick={handleOpen}
        style={{
          position: "relative",
          width: 28,
          height: 28,
          borderRadius: 4,
          backgroundImage: CHECKERBOARD,
          border: "2px solid var(--t-border)",
          cursor: "pointer",
          flexShrink: 0,
          padding: 0,
          overflow: "hidden"
        }}
        title={value}
      >
        <div style={{ width: "100%", height: "100%", background: value }} />
      </button>
      {open && anchorRect && (
        <Popover
          hsva={hsva}
          setHsva={setHsva}
          hexInput={hexInput}
          setHexInput={setHexInput}
          onClose={() => setOpen(false)}
          anchorRect={anchorRect}
        />
      )}
    </>
  );
}