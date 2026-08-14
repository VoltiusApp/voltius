/**
 * Wording shared by the settings domain and the settings verbs.
 *
 * Its own module, with no imports: the tool surface must not reach into
 * `@/stores`, which importing the domain for one string would do.
 */
export const unknownSetting = (key: string): string => `Unknown setting "${key}"`;
