/**
 * A plugin id becomes a directory name under `$APP_DATA/plugins/<id>/` and the key
 * for every per-plugin namespace, so it has to be constrained at the door rather
 * than sanitised at each use site.
 *
 * The charset is deliberately permissive — it accepts every reasonable id and only
 * rejects delimiters and path-escape characters. Two properties are load-bearing:
 *  - lowercase only, so two ids can't collide into one directory on the
 *    case-insensitive filesystems of macOS and Windows;
 *  - must START with an alphanumeric, which keeps the reserved `__meta__` directory
 *    (installed-plugin list, marketplace sources, seeded tombstones) unclaimable by
 *    a plugin.
 */
const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9._-]*$/;

export const PLUGIN_ID_MAX_LENGTH = 64;

export function isValidPluginId(id: unknown): id is string {
  return (
    typeof id === "string" &&
    id.length <= PLUGIN_ID_MAX_LENGTH &&
    id !== "." &&
    id !== ".." &&
    PLUGIN_ID_RE.test(id)
  );
}

export function assertValidPluginId(id: unknown): asserts id is string {
  if (!isValidPluginId(id)) {
    throw new Error(
      `Invalid plugin id ${JSON.stringify(id)}: expected ${PLUGIN_ID_RE.source}, ` +
        `at most ${PLUGIN_ID_MAX_LENGTH} characters.`,
    );
  }
}
