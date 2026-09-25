import i18n from "@/i18n";

// Dates, numbers and sort order follow the app language, not the OS locale:
// `toLocaleDateString()` and `Intl.*(undefined)` would show an English date
// inside a French UI on an English system. Formatters are cached per locale
// and options, since constructing Intl objects is comparatively slow.

type DateInput = Date | number | string;

const cache = new Map<string, Intl.DateTimeFormat | Intl.NumberFormat | Intl.Collator>();

/** The app language, as a BCP 47 tag for Intl. */
export function appLocale(): string {
  return i18n.language || "en";
}

function cached<T extends Intl.DateTimeFormat | Intl.NumberFormat | Intl.Collator>(
  kind: string,
  options: object,
  make: (locale: string) => T,
): T {
  const locale = appLocale();
  const key = `${kind}|${locale}|${JSON.stringify(options)}`;
  let formatter = cache.get(key) as T | undefined;
  if (!formatter) {
    formatter = make(locale);
    cache.set(key, formatter);
  }
  return formatter;
}

const toDate = (d: DateInput): Date => (d instanceof Date ? d : new Date(d));

function formatDateTimeWith(d: DateInput, options: Intl.DateTimeFormatOptions): string {
  return cached("dt", options, (l) => new Intl.DateTimeFormat(l, options)).format(toDate(d));
}

const DATE: Intl.DateTimeFormatOptions = { year: "numeric", month: "numeric", day: "numeric" };
const TIME: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit", second: "2-digit" };

/** "Mar 4, 2026" */
export const SHORT_DATE: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" };
/** "Mar 4" */
export const MONTH_DAY: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
/** "14:05" / "02:05 PM" */
export const HOUR_MINUTE: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
/** "Mar 4, 14:05" */
export const MONTH_DAY_TIME: Intl.DateTimeFormatOptions = { ...MONTH_DAY, ...HOUR_MINUTE };

/** A date; numeric by default, like `toLocaleDateString()`. */
export function formatDate(d: DateInput, options: Intl.DateTimeFormatOptions = DATE): string {
  return formatDateTimeWith(d, options);
}

/** `formatDate` for a date that may be missing. */
export function formatOptionalDate(d: DateInput | null | undefined, options?: Intl.DateTimeFormatOptions): string | null {
  return d == null ? null : formatDate(d, options);
}

/** A time of day; with seconds by default, like `toLocaleTimeString()`. */
export function formatTime(d: DateInput, options: Intl.DateTimeFormatOptions = TIME): string {
  return formatDateTimeWith(d, options);
}

/** Date and time; numeric by default, like `toLocaleString()`. */
export function formatDateTime(d: DateInput, options: Intl.DateTimeFormatOptions = { ...DATE, ...TIME }): string {
  return formatDateTimeWith(d, options);
}

export function formatNumber(n: number, options: Intl.NumberFormatOptions = {}): string {
  return cached("num", options, (l) => new Intl.NumberFormat(l, options)).format(n);
}

/**
 * "just now", "5m ago", "3h ago", "2d ago". With `seconds`, counts seconds
 * under a minute; with `maxDays`, falls back to the date from that age on.
 */
export function formatRelative(d: DateInput, { seconds = false, maxDays = Infinity } = {}): string {
  const s = Math.floor((Date.now() - toDate(d).getTime()) / 1000);
  if (s < (seconds ? 5 : 60)) return i18n.t("common.relativeTime.justNow");
  if (s < 60) return i18n.t("common.relativeTime.secondsAgo", { count: s });
  const m = Math.floor(s / 60);
  if (m < 60) return i18n.t("common.relativeTime.minutesAgo", { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return i18n.t("common.relativeTime.hoursAgo", { count: h });
  const days = Math.floor(h / 24);
  if (days < maxDays) return i18n.t("common.relativeTime.daysAgo", { count: days });
  return formatDate(d);
}

/** Compare for a user-visible sort, in the app language's alphabet order. */
export function compareStrings(a: string, b: string): number {
  return cached("coll", {}, (l) => new Intl.Collator(l)).compare(a, b);
}
