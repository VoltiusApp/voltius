// The only specifiers the host resolves for a plugin bundle. Zero-dependency by
// design: vite.plugins.config.ts imports this at config-eval time (Node, not the
// webview), so it must not pull in react/react-dom/@voltius-ui or anything else with
// module-level side effects. hostModules.ts, the bundle-build test, and the build
// config all import from here so the effective list can't drift between them.
export const HOST_SPECIFIERS = [
  "react",
  "react/jsx-runtime",
  "react-dom",
  // Shared so a plugin resolves icons against the host's own Iconify storage. The
  // host registers hand-written collections (src/utils/icons.ts addCollection —
  // "devicon", "simple-icons", "custom") that do not exist on the public Iconify
  // API, so a bundle with its own inlined copy renders them as an empty <span>
  // with no error and no network fallback.
  "@iconify/react",
  "@voltius/ui",
  "@voltius/api",
  "@voltius/tools",
  // Shared so the host's tool schemas (@voltius/tools) and a plugin's own
  // schemas are one instance. It does NOT eliminate every copy: the AI SDK
  // imports the zod/v3 and zod/v4 subpaths, which this exact-match external
  // list does not cover, so a bundle still inlines one. That is safe because
  // zod v4's toJSONSchema is trait-driven, not instanceof-driven.
  "zod",
] as const;
