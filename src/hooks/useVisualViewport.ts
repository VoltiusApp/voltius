import { useEffect, useState } from "react";
import { computeKeyboardLayout, type KeyboardLayout } from "./visualViewportCore";

const INITIAL: KeyboardLayout = { keyboardVisible: false, bottomInset: 0, usableHeight: 0, offsetTop: 0 };

export function useVisualViewport(): KeyboardLayout {
  const [layout, setLayout] = useState<KeyboardLayout>(INITIAL);
  useEffect(() => {
    const vv = window.visualViewport;
    let frame: number | null = null;
    const read = () => {
      frame = null;
      setLayout(computeKeyboardLayout({
        layoutHeight: window.innerHeight,
        visualHeight: vv ? vv.height : window.innerHeight,
        visualOffsetTop: vv ? vv.offsetTop : 0,
        nativeIme: (window as { __voltiusInsets?: { ime?: number } }).__voltiusInsets?.ime,
      }));
    };
    const schedule = () => { if (frame === null) frame = requestAnimationFrame(read); };
    read();
    vv?.addEventListener("resize", schedule);
    vv?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    // Android native insets bridge (SystemInsets.kt): keyboard open/close arrives here too.
    window.addEventListener("voltius:insets", schedule);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      vv?.removeEventListener("resize", schedule);
      vv?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("voltius:insets", schedule);
    };
  }, []);
  return layout;
}
