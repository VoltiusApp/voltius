# @voltius/plugin-types

TypeScript definitions for the [Voltius](https://github.com/VoltiusApp/voltius) plugin API.

```bash
npm install --save-dev @voltius/plugin-types
```

```ts
import type { PluginAPI } from "@voltius/plugin-types";

export default function register(api: PluginAPI): () => void {
  const dispose = api.ui.registerRightPanelSection({ /* ... */ });
  return () => dispose();
}
```

Types only — there is no runtime code. The host provides the implementation.

**Versions track the app.** `@voltius/plugin-types@0.14.1` describes the API in Voltius 0.14.1.

`ui.d.ts` declares the `@voltius/ui` module (the host components plugins may import). It is
included automatically; you do not need to reference it.

Generated from `src/plugins/api.ts` — see
[developing plugins](https://docs.voltius.app/plugins/developing) and the
[template repo](https://github.com/VoltiusApp/voltius-plugin-template).
