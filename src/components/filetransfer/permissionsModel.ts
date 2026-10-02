export type Tri = boolean | "mixed";

/** Grid order: owner rwx, group rwx, others rwx, then setuid, setgid, sticky. */
export const MODE_BITS = [
  0o400, 0o200, 0o100, 0o040, 0o020, 0o010, 0o004, 0o002, 0o001,
  0o4000, 0o2000, 0o1000,
] as const;
const RWX_COUNT = 9;

export function triBits(modes: number[]): Tri[] {
  return MODE_BITS.map((bit) => {
    const on = modes.filter((m) => (m & bit) !== 0).length;
    return on === 0 ? false : on === modes.length ? true : "mixed";
  });
}

export function toOctal(bits: Tri[]): string | null {
  if (bits.includes("mixed")) return null;
  const mode = MODE_BITS.reduce((acc, bit, i) => (bits[i] ? acc | bit : acc), 0);
  return mode.toString(8).padStart(mode > 0o777 ? 4 : 3, "0");
}

/** Three digits keep the special bits from `current`; four replace them. */
export function parseOctal(text: string, current: Tri[]): Tri[] | null {
  if (!/^[0-7]{3,4}$/.test(text)) return null;
  const mode = parseInt(text, 8);
  return MODE_BITS.map((bit, i) =>
    i >= RWX_COUNT && text.length === 3 ? current[i] : (mode & bit) !== 0,
  );
}

export function symbolicMode(bits: Tri[]): string {
  const ch = (b: Tri, on: string) => (b === "mixed" ? "?" : b ? on : "-");
  const exec = (x: Tri, special: Tri, lower: string, upper: string) => {
    if (x === "mixed" || special === "mixed") return "?";
    if (special) return x ? lower : upper;
    return x ? "x" : "-";
  };
  const specials = [bits[9], bits[10], bits[11]];
  const triad = (i: number, lower: string, upper: string) =>
    ch(bits[i * 3], "r") + ch(bits[i * 3 + 1], "w") + exec(bits[i * 3 + 2], specials[i], lower, upper);
  return triad(0, "s", "S") + triad(1, "s", "S") + triad(2, "t", "T");
}

/** A bit the selection disagreed on can be put back to "leave as each file has it". */
export function cycleBit(current: Tri, initial: Tri): Tri {
  if (initial !== "mixed") return !current;
  return current === "mixed" ? true : current ? false : "mixed";
}

/** Every settled rwx bit is applied, so a tree ends up with exactly what the
 *  grid shows; special bits only when the user changed them. */
export function modeChange(initial: Tri[], edited: Tri[]): { set: number; clear: number } {
  let set = 0;
  let clear = 0;
  MODE_BITS.forEach((bit, i) => {
    const b = edited[i];
    if (b === "mixed" || (i >= RWX_COUNT && b === initial[i])) return;
    if (b) set |= bit;
    else clear |= bit;
  });
  return { set, clear };
}

export function commonValue<T>(values: T[]): T | null {
  return values.length > 0 && values.every((v) => v === values[0]) ? values[0] : null;
}

export function nameChange(initial: string | null, edited: string): string | undefined {
  const name = edited.trim();
  return name === "" || name === initial ? undefined : name;
}
