import type { Connection, TerminalSession } from "@/types";

/** Whether a dropped session should be chased by the reconnect backoff.
 *
 * Only serial can be turned off (#192): the loop reclaims the port every few
 * seconds, which locks out the flashing tool the user just started. The
 * preference lives on the connection so it survives a restart and follows the
 * device; an ephemeral serial session has nowhere to persist it and falls back
 * to a flag on the session itself. */
export function serialAutoReconnectEnabled(
  session: TerminalSession,
  connection: Connection | undefined,
): boolean {
  if (session.type !== "serial") return true;
  return connection?.serial_auto_reconnect ?? session.autoReconnect ?? true;
}
