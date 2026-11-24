// Android tap-target audit (C7). Evaluate in the app WebView over CDP, e.g. with the emulator
// tooling: js "$(cat scripts/android-tap-target-audit.js)". Returns {small, exceptions, checked, skipped}:
// every on-screen control whose 48x48 CSS px square around its centre does not all land on it.
(() => {
  // Tap-target audit: every on-screen interactive element must accept taps over a 48x48 CSS px
  // square centred on it. Probed with elementFromPoint, so hit areas extended by a pseudo-element
  // (or a larger parent that forwards the tap) count, and visual size alone doesn't.
  const MIN = 48, R = MIN / 2 - 1;
  const SEL = 'button, a[href], [role=button], [role=tab], [role=switch], [role=checkbox], [role=menuitem], input:not([type=hidden]), select, textarea, [data-ripple], [onclick], [data-mobile-sheet-handle]';
  const vw = innerWidth, vh = innerHeight;
  const name = (el) => {
    const attrs = [...el.attributes].filter((a) => a.name.startsWith('data-') && !a.name.startsWith('data-state')).map((a) => a.value && a.value.length < 30 ? `[${a.name}=${a.value}]` : `[${a.name}]`).slice(0, 2).join('');
    const label = (el.getAttribute('aria-label') || el.title || el.placeholder || el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 28);
    return `${el.tagName.toLowerCase()}${attrs}${label ? ` "${label}"` : ''}`;
  };
  const INTERACTIVE = 'button, a[href], input, select, textarea, [role=button], [role=switch]';
  const owns = (el, hit) => {
    if (!hit) return false;
    if (el === hit || el.contains(hit)) return true;
    if (hit.closest('label')?.contains(el)) return true; // a <label> forwards the tap to its control
    // C4/C5 list rows forward a tap anywhere on the row to their [data-row-control] (rowTapControl).
    const row = el.hasAttribute('data-row-control') && el.closest('[data-setting-row]');
    if (row && row.contains(hit)) { const other = hit.closest(INTERACTIVE); return !other || other === row || !row.contains(other); }
    return false;
  };
  const out = [], exceptions = [], seen = new Set();
  let skipped = 0;
  for (const el of document.querySelectorAll(SEL)) {
    if (el.disabled || el.closest('.xterm')) continue;
    // Count a control once: an inner button of an already-audited row is audited on its own.
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (cx < 0 || cy < 0 || cx > vw || cy > vh) { skipped++; continue; }
    if (!owns(el, document.elementFromPoint(cx, cy))) { skipped++; continue; } // covered / not top-most
    if (seen.has(el)) continue; seen.add(el);
    // The nearest scroll container: a probe past its edge lands on content scrolled out of view
    // (a chip half under the strip's edge, a row half under the app bar), not on a neighbour.
    let clip = null;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll|hidden)/.test(cs.overflowX + cs.overflowY) && (p.scrollWidth > p.clientWidth + 1 || p.scrollHeight > p.clientHeight + 1)) { clip = p.getBoundingClientRect(); break; }
    }
    const probes = [[-R, 0], [R, 0], [0, -R], [0, R]];
    const miss = probes.filter(([dx, dy]) => {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= vw || y >= vh) return false; // screen edge: Fitts, the edge is infinite
      if (clip && (x < clip.left || x > clip.right || y < clip.top || y > clip.bottom)) return false;
      return !owns(el, document.elementFromPoint(x, y));
    });
    // Extra-keys row and drawer: keys tile the strip like an IME (Termux/Gboard sizes), so a probe
    // past a key's edge lands on the neighbouring key, never on nothing.
    const strip = el.closest('[data-mobile-extra-keys], [data-mobile-keys-drawer]');
    if (miss.length && strip && miss.every(([dx, dy]) => strip.contains(document.elementFromPoint(cx + dx, cy + dy)))) { exceptions.push(name(el)); continue; }
    if (miss.length) out.push(`${Math.round(r.width)}x${Math.round(r.height)}  ${name(el)}  misses:${miss.map(([dx, dy]) => dx < 0 ? 'L' : dx > 0 ? 'R' : dy < 0 ? 'T' : 'B').join('')}`);
  }
  return { small: out, exceptions, checked: seen.size, skipped };
})()
