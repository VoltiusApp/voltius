/** Pure keyboard-layout math from visualViewport readings — no DOM, node-testable. */
export interface ViewportInput {
  layoutHeight: number;   // window.innerHeight
  visualHeight: number;   // visualViewport.height
  visualOffsetTop: number; // visualViewport.offsetTop
}
export interface KeyboardLayout {
  keyboardVisible: boolean;
  bottomInset: number;   // px the keyboard occupies at the bottom of the layout viewport
  usableHeight: number;  // usable height for the app stack
}
/** Inset below which a delta is toolbar noise, not a keyboard. */
const KEYBOARD_MIN_INSET = 120;
export function computeKeyboardLayout(i: ViewportInput): KeyboardLayout {
  const bottomInset = Math.max(0, i.layoutHeight - i.visualHeight - i.visualOffsetTop);
  const keyboardVisible = bottomInset >= KEYBOARD_MIN_INSET;
  return {
    keyboardVisible,
    bottomInset: keyboardVisible ? bottomInset : 0,
    usableHeight: i.visualHeight,
  };
}
