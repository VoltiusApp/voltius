import { create } from "zustand";
import type { DeepLinkIntent } from "@/services/deepLinkUrl";

function sameIntent(a: DeepLinkIntent | null, b: DeepLinkIntent): boolean {
  return a?.route === b.route && a?.sessionId === b.sessionId && a?.token === b.token;
}

interface DeepLinkStore {
  ready: boolean;
  pending: DeepLinkIntent | null;
  prompt: DeepLinkIntent | null;

  setReady(ready: boolean): void;
  enqueue(intent: DeepLinkIntent): void;
  dismissPrompt(): void;
}

export const useDeepLinkStore = create<DeepLinkStore>((set, get) => ({
  ready: false,
  pending: null,
  prompt: null,

  setReady: (ready) => {
    const { pending } = get();
    if (ready && pending) set({ ready, pending: null, prompt: pending });
    else set({ ready });
  },

  // A cold start delivers the same URL twice (getCurrent plus an onOpenUrl echo),
  // hence the no-op on an identical intent. A visible `prompt` is never swapped:
  // the sheet shows no identifying detail, so the user could confirm the wrong
  // session without noticing.
  enqueue: (intent) => {
    const { ready, pending, prompt } = get();
    if (sameIntent(pending, intent) || sameIntent(prompt, intent)) return;
    if (prompt) set({ pending: intent });
    else if (ready) set({ prompt: intent, pending: null });
    else set({ pending: intent });
  },

  // Surfaces a link queued behind the prompt, rather than losing it.
  dismissPrompt: () => {
    const { pending } = get();
    set(pending ? { prompt: pending, pending: null } : { prompt: null });
  },
}));
