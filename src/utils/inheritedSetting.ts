// undefined inherits globalEnabled; otherwise the host forces it off (true) or on (false).
export function resolveDisableOverride(
  override: boolean | undefined,
  globalEnabled: boolean,
): boolean {
  return override === undefined ? globalEnabled : !override;
}
