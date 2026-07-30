// The only specifiers the host resolves for a plugin bundle. Zero-dependency by
// design: vite.plugins.config.ts imports this at config-eval time (Node, not the
// webview), so it must not pull in react/react-dom/@voltius-ui or anything else with
// module-level side effects. hostModules.ts, the bundle-build test, and the build
// config all import from here so the effective list can't drift between them.
export const HOST_SPECIFIERS = [
  "react",
  "react/jsx-runtime",
  "react-dom",
  "@voltius/ui",
  "@voltius/api",
] as const;
