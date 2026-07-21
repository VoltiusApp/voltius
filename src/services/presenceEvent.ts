export interface UsingEvent {
  userId: string;
  connectionId: string;
  inUse: boolean;
}

/** Parse an SSE presence line `using:<userId>:<connectionId>:<0|1>`. Returns null if malformed. */
export function parseUsingEvent(eventData: string): UsingEvent | null {
  if (!eventData.startsWith("using:")) return null;
  const rest = eventData.slice("using:".length);
  const firstColon = rest.indexOf(":");
  const lastColon = rest.lastIndexOf(":");
  if (firstColon > 0 && lastColon > firstColon) {
    return {
      userId: rest.slice(0, firstColon),
      connectionId: rest.slice(firstColon + 1, lastColon),
      inUse: rest.slice(lastColon + 1) === "1",
    };
  }
  return null;
}
