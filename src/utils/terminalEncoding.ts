// A session's terminal encoding (Connection.terminal_encoding) applies both
// ways: output bytes are decoded with it, and typed/pasted text is encoded with
// it. The browser only ships a UTF-8 *encoder*, so the legacy encodings get
// theirs by inverting the platform TextDecoder — whatever we send therefore
// decodes back, on our side and on the host's, to the character the user typed.

const utf8 = new TextEncoder();
const REPLACEMENT_CHAR = String.fromCodePoint(0xfffd);

/** WHATWG canonical name for a label (`"shift-jis"` → `"shift_jis"`), or null
 *  for UTF-8 and for labels the platform does not know — both mean "UTF-8". */
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

export interface OutputDecoder {
  /** UTF-8 passes the bytes through untouched — xterm streams UTF-8 itself. */
  decode(data: Uint8Array): string | Uint8Array;
  /** Drop a partial character held from a transport that is gone. */
  reset(): void;
}

/** Streaming output decoder: a multibyte character split across two output
 *  chunks is held until its tail arrives, instead of rendering as two U+FFFD. */
export function createOutputDecoder(encoding: string | undefined): OutputDecoder {
  const name = canonicalEncoding(encoding);
  if (!name) return { decode: (data) => data, reset: () => {} };
  let decoder = new TextDecoder(name);
  return {
    decode: (data) => decoder.decode(data, { stream: true }),
    reset: () => { decoder = new TextDecoder(name); },
  };
}

const MULTIBYTE = new Set(["gbk", "gb18030", "big5", "shift_jis", "euc-jp", "euc-kr"]);

/** Inclusive [first, last] byte range per position of a sequence. */
type Shape = [number, number][];

/** Character → its byte sequence packed big-endian into one number (no
 *  sequence starts with 0x00, so the byte count is implied). */
const tables = new Map<string, Map<string, number>>();

/** Build the table by decoding every sequence the encoding can hold; the first
 *  sequence for a character wins. One decode call per shape with a "\n" after
 *  each sequence: every decoder here emits an ASCII byte as itself even where
 *  it cuts a character short, so the output splits back into one piece per
 *  sequence, and a piece that is not exactly one character is not a mapping. */
function encodeTable(name: string): Map<string, number> {
  const cached = tables.get(name);
  if (cached) return cached;
  const decoder = new TextDecoder(name);
  const table = new Map<string, number>();
  const shapes: Shape[] = [[[0x80, 0xff]]];
  // A superset of every CJK double-byte layout; combinations an encoding does
  // not define decode to U+FFFD or to two characters and are skipped.
  if (MULTIBYTE.has(name)) shapes.push([[0x81, 0xfe], [0x40, 0xfe]]);
  // GB18030's four-byte form for the rest of the BMP.
  if (name === "gb18030") shapes.push([[0x81, 0x84], [0x30, 0x39], [0x81, 0xfe], [0x30, 0x39]]);

  for (const shape of shapes) {
    const width = shape.length + 1;
    const count = shape.reduce((n, [first, last]) => n * (last - first + 1), 1);
    const buf = new Uint8Array(count * width);
    const seq = shape.map(([first]) => first);
    for (let n = 0; n < count; n++) {
      buf.set(seq, n * width);
      buf[n * width + shape.length] = 0x0a;
      // Odometer step: bump the last position, carrying into earlier ones.
      let i = seq.length - 1;
      while (i > 0 && seq[i] === shape[i][1]) seq[i] = shape[i--][0];
      seq[i]++;
    }
    decoder.decode(buf).split("\n").forEach((ch, n) => {
      if (n >= count || ch === REPLACEMENT_CHAR || table.has(ch)) return;
      if (ch.length !== 1 && !(ch.length === 2 && ch.codePointAt(0)! > 0xffff)) return;
      let packed = 0;
      for (let i = 0; i < shape.length; i++) packed = packed * 256 + buf[n * width + i];
      table.set(ch, packed);
    });
  }
  tables.set(name, table);
  return table;
}

/** Encode input text for a session's terminal encoding. A character the
 *  encoding cannot represent is sent as "?", as a native terminal would. */
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
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) {
      out.push(cp);
      continue;
    }
    const start = out.length;
    for (let packed = table.get(ch) ?? 0x3f; packed > 0; packed = Math.floor(packed / 256)) {
      out.splice(start, 0, packed % 256);
    }
  }
  return Uint8Array.from(out);
}
