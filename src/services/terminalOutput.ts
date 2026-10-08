import type { UnlistenFn } from "@tauri-apps/api/event";
import { Channel, invoke } from "@/lib/invoke";
import { logFailure } from "@/lib/logger";

type OutputHandler = (data: Uint8Array) => void;
type ClosedHandler = (cleanExit: boolean) => void;

interface Stream {
  channel: Channel<unknown>;
  output: Set<OutputHandler>;
  closed: Set<ClosedHandler>;
  attached: Promise<void>;
}

const streams = new Map<string, Stream>();
const reportHandlerError = logFailure("terminal output handler");

function each<T>(handlers: Set<(value: T) => void>, value: T) {
  for (const handler of handlers) {
    try {
      handler(value);
    } catch (e) {
      reportHandlerError(e);
    }
  }
}

function dispatch(stream: Stream, message: unknown) {
  if (typeof message === "boolean") each(stream.closed, message);
  else if (message instanceof ArrayBuffer) each(stream.output, new Uint8Array(message));
  else if (Array.isArray(message)) each(stream.output, Uint8Array.from(message as number[]));
}

function open(sessionId: string, gated: boolean): Stream {
  const existing = streams.get(sessionId);
  if (existing) return existing;
  const channel = new Channel<unknown>();
  const stream: Stream = { channel, output: new Set(), closed: new Set(), attached: Promise.resolve() };
  channel.onmessage = (message) => dispatch(stream, message);
  stream.attached = invoke("terminal_output_attach", { sessionId, gated, channel });
  streams.set(sessionId, stream);
  return stream;
}

function release(sessionId: string, stream: Stream) {
  if (stream.output.size || stream.closed.size || streams.get(sessionId) !== stream) return;
  streams.delete(sessionId);
  stream.channel.onmessage = () => {};
  invoke("terminal_output_detach", { sessionId, channelId: stream.channel.id }).catch(
    logFailure("terminal output detach"),
  );
}

/** One backend channel per session, shared by the terminal, plugins and the multiplayer
 *  broadcast. A gated (local) stream is held by the backend until `local_ready`. */
async function subscribe<T>(
  sessionId: string,
  gated: boolean,
  pick: (stream: Stream) => Set<(value: T) => void>,
  handler: (value: T) => void,
): Promise<UnlistenFn> {
  const stream = open(sessionId, gated);
  const handlers = pick(stream);
  handlers.add(handler);
  const unsubscribe = () => {
    handlers.delete(handler);
    release(sessionId, stream);
  };
  try {
    await stream.attached;
  } catch (e) {
    unsubscribe();
    throw e;
  }
  return unsubscribe;
}

export function onTerminalOutput(sessionId: string, gated: boolean, handler: OutputHandler): Promise<UnlistenFn> {
  return subscribe(sessionId, gated, (s) => s.output, handler);
}

export function onTerminalClosed(sessionId: string, gated: boolean, handler: ClosedHandler): Promise<UnlistenFn> {
  return subscribe(sessionId, gated, (s) => s.closed, handler);
}
