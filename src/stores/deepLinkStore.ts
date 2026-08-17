import { create } from "zustand";
import {
  intentKey,
  isConfirmIntent,
  type ConfirmIntent,
  type DeepLinkIntent,
  type SilentIntent,
} from "@/services/deepLinkUrl";

/**
 * A cap, not a design: a burst this size means something is firing links at us,
 * and holding them all would let it push a real one off the end anyway.
 */
const MAX_QUEUE = 4;

/**
 * Kept out of the store's state so a test resetting state cannot leave a stale
 * handler installed, and so the store never imports the handler module.
 */
let silentHandler: ((intent: SilentIntent) => void) | null = null;

// Suppresses only the cold-start echo (getCurrent plus onOpenUrl delivering
// the same URL), not a deliberate retry: a failed handler run is not fatal,
// so the window must not outlive the user's next click.
let lastSilent: { key: string; at: number } | null = null;
const SILENT_ECHO_WINDOW_MS = 5000;

interface DeepLinkStore {
  ready: boolean;
  queue: DeepLinkIntent[];
  prompt: ConfirmIntent | null;

  setReady(ready: boolean): void;
  setSilentHandler(fn: ((intent: SilentIntent) => void) | null): void;
  enqueue(intent: DeepLinkIntent): void;
  dismissPrompt(): void;
}

export const useDeepLinkStore = create<DeepLinkStore>((set, get) => ({
  ready: false,
  queue: [],
  prompt: null,

  setSilentHandler: (fn) => {
    silentHandler = fn;
    lastSilent = null;
  },

  setReady: (ready) => {
    set({ ready });
    if (ready) drain();
  },

  // A cold start delivers the same URL twice (getCurrent plus an onOpenUrl
  // echo), hence the key check against everything currently held. A visible
  // `prompt` is never swapped: the sheet shows no identifying detail, so the
  // user could confirm the wrong session without noticing.
  enqueue: (intent) => {
    const { queue, prompt } = get();
    const key = intentKey(intent);
    if (prompt && intentKey(prompt) === key) return;
    if (queue.some((queued) => intentKey(queued) === key)) return;
    set({ queue: [...queue, intent].slice(-MAX_QUEUE) });
    drain();
  },

  // Surfaces a link queued behind the prompt, rather than losing it.
  dismissPrompt: () => {
    set({ prompt: null });
    drain();
  },
}));

function drain(): void {
  const { ready, queue, prompt } = useDeepLinkStore.getState();
  if (!ready) return;

  const rest: DeepLinkIntent[] = [];
  let nextPrompt = prompt;
  for (const intent of queue) {
    if (!isConfirmIntent(intent)) {
      const key = intentKey(intent);
      const now = Date.now();
      if (lastSilent?.key === key && now - lastSilent.at < SILENT_ECHO_WINDOW_MS) continue;
      lastSilent = { key, at: now };
      silentHandler?.(intent);
      continue;
    }
    if (!nextPrompt) nextPrompt = intent;
    else rest.push(intent);
  }
  useDeepLinkStore.setState({ queue: rest, prompt: nextPrompt });
}
