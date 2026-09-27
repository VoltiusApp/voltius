const utf8 = new TextEncoder();
const REPLACEMENT_CHAR = String.fromCodePoint(0xfffd);

/** WHATWG canonical name for a label, or null for UTF-8 and unknown labels (both mean UTF-8). */
function canonicalEncoding(label: string | undefined): string | null {
  if (!label) return null;
  let name: string;
  try {
    name = new TextDecoder(label).encoding;
  } catch {
    return null;
  }
  return name === "utf-8" ? null : name;
}

/** A TextDecoder for the session's encoding, UTF-8 when unset or unknown. */
export function createTextDecoder(encoding: string | undefined): TextDecoder {
  return new TextDecoder(canonicalEncoding(encoding) ?? "utf-8");
}

export interface OutputDecoder {
  /** UTF-8 passes the bytes through untouched: xterm streams UTF-8 itself. */
  decode(data: Uint8Array): string | Uint8Array;
  reset(): void;
}

/** Holds a multibyte character split across output chunks until its tail arrives. */
export function createOutputDecoder(encoding: string | undefined): OutputDecoder {
  if (!canonicalEncoding(encoding)) return { decode: (data) => data, reset: () => {} };
  let decoder = createTextDecoder(encoding);
  return {
    decode: (data) => decoder.decode(data, { stream: true }),
    reset: () => { decoder = createTextDecoder(encoding); },
  };
}

/** Streams a session's output as UTF-8, the multiplayer relay's wire encoding. */
export function createUtf8Transcoder(encoding: string | undefined): (data: Uint8Array) => Uint8Array {
  const decoder = createOutputDecoder(encoding);
  return (data) => {
    const out = decoder.decode(data);
    return typeof out === "string" ? utf8.encode(out) : out;
  };
}

/** The byte sequences each WHATWG multibyte encoder emits; the platform decoder may accept more. */
const MULTIBYTE: Record<string, { single: (b: number) => boolean; pair: (lead: number, trail: number) => boolean }> = {
  gbk: { single: (b) => b === 0x80, pair: (_, t) => t !== 0x7f && t !== 0xff },
  gb18030: { single: () => false, pair: (_, t) => t !== 0x7f && t !== 0xff },
  big5: { single: () => false, pair: (l, t) => l >= 0xa1 && (t <= 0x7e || t >= 0xa1) },
  shift_jis: {
    single: (b) => b === 0x80 || (b >= 0xa1 && b <= 0xdf),
    pair: (l, t) => (l <= 0x9f || (l >= 0xe0 && l <= 0xec) || (l >= 0xfa && l <= 0xfc)) && t !== 0x7f && t <= 0xfc,
  },
  "euc-jp": { single: () => false, pair: (l, t) => (l === 0x8e ? t >= 0xa1 && t <= 0xdf : l >= 0xa1 && t >= 0xa1) },
  "euc-kr": { single: () => false, pair: (_, t) => t >= 0x41 },
};

/** Big5 characters the WHATWG encoder maps to their last sequence instead of their first. */
const BIG5_LAST_WINS = new Set(["═", "╞", "╡", "╪", "十", "卅"]);

/** Characters typed as the Unicode twin (WHATWG encoder, macOS IME) of what the JIS decoder yields. */
const JIS_ALIASES: Record<string, string | number> = {
  "¥": 0x5c, "‾": 0x7e, "−": "－", "〜": "～", "‖": "∥",
};

/** Character → its byte sequence packed big-endian into one number. */
const tables = new Map<string, Map<string, number>>();

/** Inverts the platform decoder over every one- and two-byte sequence. Each is followed by "\n",
 *  which every decoder here emits as itself even after a cut-short character. */
function encodeTable(name: string): Map<string, number> {
  const cached = tables.get(name);
  if (cached) return cached;
  const decoder = new TextDecoder(name);
  const table = new Map<string, number>();
  const spec = MULTIBYTE[name];
  const add = (ch: string, packed: number) => {
    if (ch === REPLACEMENT_CHAR || [...ch].length !== 1) return;
    if (!table.has(ch) || (name === "big5" && BIG5_LAST_WINS.has(ch))) table.set(ch, packed);
  };
  const invert = (seqs: number[], width: number) => {
    const buf = new Uint8Array(seqs.length * (width + 1));
    seqs.forEach((seq, i) => {
      for (let b = 0; b < width; b++) buf[i * (width + 1) + b] = (seq >> (8 * (width - 1 - b))) & 0xff;
      buf[i * (width + 1) + width] = 0x0a;
    });
    decoder.decode(buf).split("\n").slice(0, seqs.length).forEach((ch, i) => add(ch, seqs[i]));
  };

  const singles: number[] = [];
  for (let b = 0x80; b <= 0xff; b++) if (!spec || spec.single(b)) singles.push(b);
  invert(singles, 1);
  if (spec) {
    const pairs: number[] = [];
    for (let l = 0x81; l <= 0xfe; l++) for (let t = 0x40; t <= 0xfe; t++) if (spec.pair(l, t)) pairs.push(l * 256 + t);
    invert(pairs, 2);
  }

  // An encoding that holds only the fullwidth form (￠) still takes the halfwidth one (¢); gb18030 holds both.
  for (const [ch, packed] of name === "gb18030" ? [] : [...table]) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0xff00 || cp > 0xffef) continue;
    const compat = ch.normalize("NFKC");
    if (compat.length === 1 && compat.charCodeAt(0) >= 0x80 && !table.has(compat)) table.set(compat, packed);
  }
  if (name === "shift_jis" || name === "euc-jp") {
    for (const [ch, target] of Object.entries(JIS_ALIASES)) {
      const packed = typeof target === "number" ? target : table.get(target);
      if (packed !== undefined) table.set(ch, packed);
    }
  }
  tables.set(name, table);
  return table;
}

/** GB18030 four-byte sequence for a pointer: 0–39419 cover the BMP, 189000 up the other planes. */
function gb18030FourByte(pointer: number): number {
  const b4 = pointer % 10;
  pointer = Math.floor(pointer / 10);
  const b3 = pointer % 126;
  pointer = Math.floor(pointer / 126);
  const b2 = pointer % 10;
  const b1 = Math.floor(pointer / 10);
  return (((b1 + 0x81) * 256 + b2 + 0x30) * 256 + b3 + 0x81) * 256 + b4 + 0x30;
}

/** The BMP four-byte pointers map to code points in increasing order, bar the one special case. */
function gb18030BmpFourByte(cp: number): number | undefined {
  if (cp === 0xe7c7) return gb18030FourByte(7457);
  const decoder = new TextDecoder("gb18030");
  let lo = 0;
  let hi = 39419;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const packed = gb18030FourByte(mid);
    const got = mid === 7457 ? 0x1e3f : decoder.decode(Uint8Array.of(packed >>> 24, (packed >> 16) & 0xff, (packed >> 8) & 0xff, packed & 0xff)).codePointAt(0)!;
    if (got === cp) return packed;
    if (got < cp) lo = mid + 1;
    else hi = mid - 1;
  }
  return undefined;
}

function encodeChar(name: string, table: Map<string, number>, ch: string): number | undefined {
  const cp = ch.codePointAt(0)!;
  if (cp < 0x80) return cp;
  const packed = table.get(ch);
  if (packed !== undefined || name !== "gb18030") return packed;
  return cp > 0xffff ? gb18030FourByte(cp - 0x10000 + 189000) : gb18030BmpFourByte(cp);
}

/** windows-1258 holds most Vietnamese letters as a precomposed base plus combining marks (ệ = ê + U+0323). */
function decompose(ch: string, encodable: (c: string) => boolean): string[] | null {
  const [base, ...marks] = ch.normalize("NFD");
  if (!marks.length || !marks.every((m) => /\p{M}/u.test(m))) return null;
  let head = base;
  const rest: string[] = [];
  for (const mark of marks) {
    const joined = (head + mark).normalize("NFC");
    if (joined.length === 1 && encodable(joined)) head = joined;
    else rest.push(mark);
  }
  const parts = [head, ...rest];
  return parts.every(encodable) ? parts : null;
}

function pushPacked(out: number[], packed: number): void {
  const start = out.length;
  do {
    out.splice(start, 0, packed % 256);
    packed = Math.floor(packed / 256);
  } while (packed > 0);
}

/** Encode input text for a session's terminal encoding; an unencodable character is sent as "?". */
export function encodeTerminalInput(text: string, encoding: string | undefined): Uint8Array {
  const name = canonicalEncoding(encoding);
  if (!name) return utf8.encode(text);
  if (name === "utf-16le" || name === "utf-16be") {
    const out = new Uint8Array(text.length * 2);
    const view = new DataView(out.buffer);
    for (let i = 0; i < text.length; i++) view.setUint16(i * 2, text.charCodeAt(i), name === "utf-16le");
    return out;
  }
  const table = encodeTable(name);
  const encodable = (c: string) => encodeChar(name, table, c) !== undefined;
  const out: number[] = [];
  for (const ch of text) {
    const parts = encodable(ch) ? [ch] : decompose(ch, encodable);
    if (parts) for (const part of parts) pushPacked(out, encodeChar(name, table, part)!);
    else out.push(0x3f);
  }
  return Uint8Array.from(out);
}
