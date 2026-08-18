import { create } from "zustand";
import {
  intentKey,
  isConfirmIntent,
  isUnpromptedIntent,
  type ConfirmIntent,
  type DeepLinkIntent,
  type UnpromptedIntent,
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
let unpromptedHandler: ((intent: UnpromptedIntent) => void) | null = null;

// Suppresses only the cold-start echo (getCurrent plus onOpenUrl delivering
// the same URL), not a deliberate retry: a failed handler run is not fatal,
// so the window must not outlive the user's next click.
let lastUnprompted: { key: string; at: number } | null = null;
const UNPROMPTED_ECHO_WINDOW_MS = 5000;

interface DeepLinkStore {
  ready: boolean;
  queue: DeepLinkIntent[];
  prompt: ConfirmIntent | null;

  setReady(ready: boolean): void;
  setUnpromptedHandler(fn: ((intent: UnpromptedIntent) => void) | null): void;
  enqueue(intent: DeepLinkIntent): void;
  dismissPrompt(): void;
}

export const useDeepLinkStore = create<DeepLinkStore>((set, get) => ({
  ready: false,
  queue: [],
  prompt: null,

  setUnpromptedHandler: (fn) => {
    unpromptedHandler = fn;
    lastUnprompted = null;
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

// A handler running inside drain() may enqueue, which re-enters drain(). The
// nested call returns immediately and the outer loop, which re-reads state each
// pass, picks the new intent up.
let draining = false;

function drain(): void {
  if (draining) return;
  draining = true;
  try {
    for (;;) {
      const { ready, queue, prompt } = useDeepLinkStore.getState();
      if (!ready) return;
      // A confirm intent needs a free prompt slot; everything else is handled
      // where it sits, so an unprompted link never waits behind an open sheet.
      const intent = queue.find((queued) => !prompt || !isConfirmIntent(queued));
      if (!intent) return;
      useDeepLinkStore.setState({ queue: queue.filter((queued) => queued !== intent) });

      if (isUnpromptedIntent(intent)) {
        dispatchUnprompted(intent);
        continue;
      }
      // Unknown trust class: drop it, never act on it.
      if (!isConfirmIntent(intent)) continue;
      useDeepLinkStore.setState({ prompt: intent });
    }
  } finally {
    draining = false;
  }
}

function dispatchUnprompted(intent: UnpromptedIntent): void {
  if (!unpromptedHandler) return;
  const key = intentKey(intent);
  const now = Date.now();
  if (lastUnprompted?.key === key && now - lastUnprompted.at < UNPROMPTED_ECHO_WINDOW_MS) return;
  lastUnprompted = { key, at: now };
  unpromptedHandler(intent);
}
