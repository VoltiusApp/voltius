/** Resolves with `p`, or with `orElse` if `p` rejects or outlasts `ms`. */
export async function settleWithin<T>(p: Promise<T>, ms: number, orElse: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p.catch(() => orElse),
      new Promise<T>((r) => { timer = setTimeout(() => r(orElse), ms); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
