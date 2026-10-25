// Helpers run inside the WebView. Each export is self-contained: webdriverio
// serialises the function body, so they cannot share module scope.

/** Visible text plus every interactive element, for the per-step dump. */
export function dumpPage() {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" &&
      r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  };
  const items = [];
  for (const el of document.querySelectorAll(
    "button,a,input,textarea,select,[role=button],[role=tab],[role=menuitem],[role=option],[role=switch],[role=checkbox],[contenteditable=true]",
  )) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    items.push({
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role") || undefined,
      text: (el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 80) || undefined,
      aria: el.getAttribute("aria-label") || undefined,
      title: el.getAttribute("title") || undefined,
      placeholder: el.getAttribute("placeholder") || undefined,
      name: el.getAttribute("name") || undefined,
      type: el.getAttribute("type") || undefined,
      value: el.value !== undefined && el.type !== "password" ? String(el.value).slice(0, 60) || undefined : undefined,
      testid: el.getAttribute("data-testid") || undefined,
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    });
  }
  return {
    url: location.href,
    viewport: [innerWidth, innerHeight, devicePixelRatio],
    visualViewport: window.visualViewport
      ? [visualViewport.offsetLeft, visualViewport.offsetTop, visualViewport.width, visualViewport.height, visualViewport.scale]
      : null,
    userAgent: navigator.userAgent,
    activeElement: document.activeElement ? document.activeElement.outerHTML.slice(0, 200) : null,
    text: (document.body.innerText || "").slice(0, 6000),
    items,
    xtermRows: [...document.querySelectorAll(".xterm-rows > div")].map((d) => d.textContent).join("\n").slice(-3000),
  };
}

/**
 * Finds the best visible element whose text, aria-label, title or placeholder
 * matches `pattern` (a RegExp source, case-insensitive). Interactive elements
 * and exact matches win; among equals the smallest wins. Remembers it for
 * clickLastTarget and returns its rect in CSS pixels, or null.
 */
export function findTarget(pattern) {
  const re = new RegExp(pattern, "i");
  const exactRe = new RegExp(`^(?:${pattern})$`, "i");
  // Off-screen elements count (a modal's Save button may be scrolled away);
  // the winner is scrolled into view before its rect is returned.
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
  };
  const interactive = (el) =>
    el.matches("button,a,input,textarea,select,label,[role=button],[role=tab],[role=menuitem],[role=option],[role=switch],[tabindex]") ||
    getComputedStyle(el).cursor === "pointer";
  let best = null;
  for (const el of document.body.querySelectorAll("*")) {
    const tag = el.tagName.toLowerCase();
    if (tag === "script" || tag === "style" || (el.closest("svg") && tag !== "svg")) continue;
    const own = [
      el.getAttribute("aria-label"),
      el.getAttribute("title"),
      el.getAttribute("placeholder"),
      el.children.length === 0 || interactive(el) ? (el.innerText || "").trim() : null,
    ].filter(Boolean);
    const hit = own.find((t) => re.test(t));
    if (!hit || !visible(el)) continue;
    let target = el;
    while (target && target !== document.body && !interactive(target)) target = target.parentElement;
    if (!target || target === document.body) target = el;
    const r = target.getBoundingClientRect();
    const score = (interactive(target) ? 0 : 1e9) + (own.some((t) => exactRe.test(t)) ? 0 : 1e8) + r.width * r.height;
    if (!best || score < best.score) {
      best = { score, rect: [r.x, r.y, r.width, r.height], tag: target.tagName.toLowerCase(), text: hit.slice(0, 80) };
      window.__e2eTarget = target;
    }
  }
  if (best) {
    const el = window.__e2eTarget;
    const r0 = el.getBoundingClientRect();
    if (r0.top < 0 || r0.bottom > innerHeight || r0.left < 0 || r0.right > innerWidth) {
      el.scrollIntoView({ block: "center", inline: "center" });
    }
    const r = el.getBoundingClientRect();
    best.rect = [r.x, r.y, r.width, r.height];
  }
  return best;
}

/** Clicks the element found by the last findTarget (fallback when a native tap misses). */
export function clickLastTarget() {
  const el = window.__e2eTarget;
  if (!el || !el.isConnected) return false;
  const opts = { bubbles: true, cancelable: true, view: window };
  el.dispatchEvent(new PointerEvent("pointerdown", opts));
  el.dispatchEvent(new MouseEvent("mousedown", opts));
  el.dispatchEvent(new PointerEvent("pointerup", opts));
  el.dispatchEvent(new MouseEvent("mouseup", opts));
  el.click();
  return true;
}

/**
 * Finds the input (or textarea) best described by `pattern`: placeholder,
 * aria-label, name, associated <label>, or the text of its nearest ancestor
 * holding no other input. Remembers it for setInputValue; returns its rect.
 */
export function findInput(pattern) {
  const re = new RegExp(pattern, "i");
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
  };
  const describe = (el) => {
    const parts = [el.getAttribute("placeholder"), el.getAttribute("aria-label"), el.getAttribute("name"), el.id];
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) parts.push(l.innerText);
    }
    const lab = el.closest("label");
    if (lab) parts.push(lab.innerText);
    let p = el.parentElement;
    for (let i = 0; i < 4 && p; i++, p = p.parentElement) {
      if (p.querySelectorAll("input,textarea,select").length === 1) parts.push((p.innerText || "").trim());
    }
    return parts.filter(Boolean);
  };
  for (const el of document.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=radio]),textarea")) {
    if (!visible(el) || el.classList.contains("xterm-helper-textarea")) continue;
    const d = describe(el);
    if (d.some((t) => re.test(t))) {
      window.__e2eInput = el;
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      return { rect: [r.x, r.y, r.width, r.height], described: d.join(" | ").replace(/\s+/g, " ").slice(0, 160) };
    }
  }
  return null;
}

/** Sets the value of the input found by findInput the way React sees it. */
export function setInputValue(value) {
  const el = window.__e2eInput;
  if (!el || !el.isConnected) return false;
  el.focus();
  const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return el.value === value;
}

/** Feeds text to the focused (or last) xterm the way a soft keyboard does. */
export function typeInTerminal(text) {
  const areas = [...document.querySelectorAll(".xterm-helper-textarea")];
  const ta = areas.find((a) => a === document.activeElement) || areas[areas.length - 1];
  if (!ta) return "no-terminal";
  ta.focus();
  ta.dispatchEvent(new InputEvent("input", { data: text, inputType: "insertText", bubbles: true }));
  return `typed into terminal ${areas.indexOf(ta) + 1}/${areas.length}`;
}

/** Rect of the last visible terminal, for tapping it. */
export function terminalRect() {
  const all = [...document.querySelectorAll(".xterm")].filter((x) => x.getBoundingClientRect().width > 0);
  const t = all[all.length - 1];
  if (!t) return null;
  const r = t.getBoundingClientRect();
  return [r.x, r.y, r.width, r.height];
}
