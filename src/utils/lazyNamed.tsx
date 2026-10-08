import { lazy, Suspense, type ComponentProps, type ComponentType } from "react";

/** A named export loaded on first render, in its own chunk; renders nothing until it arrives. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyNamed<M extends Record<K, ComponentType<any>>, K extends keyof M & string>(load: () => Promise<M>, name: K) {
  const Lazy = lazy(async () => ({ default: (await load())[name] }));
  return function LazyNamed(props: ComponentProps<M[K]>) {
    return (
      <Suspense fallback={null}>
        <Lazy {...props} />
      </Suspense>
    );
  };
}
