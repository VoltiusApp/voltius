export interface PolicyRange {
  min?: number;
  max?: number;
  allowed?: unknown[];
}

export const rangeOf = (v: unknown): PolicyRange | undefined =>
  v !== null && typeof v === "object" && Object.keys(v).length === 1 && "$range" in v
    ? (v as { $range: PolicyRange }).$range
    : undefined;

export const inPolicyRange = (range: PolicyRange | undefined, v: unknown): boolean =>
  !range ||
  ((range.min === undefined || (typeof v === "number" && v >= range.min)) &&
    (range.max === undefined || (typeof v === "number" && v <= range.max)) &&
    (range.allowed === undefined || range.allowed.includes(v)));

export const clampToRange = (range: PolicyRange | undefined, v: number): number =>
  Math.max(range?.min ?? -Infinity, Math.min(v, range?.max ?? Infinity));
