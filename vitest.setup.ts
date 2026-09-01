import { _api } from "@iconify/react";

// Iconify resolves an unknown icon by querying its public API, and that query arms
// retry/timeout timers — 750ms, 499ms and 4000ms for a single <Icon> render. A test
// file that finishes sooner leaves them armed; when the 4s one fires, jsdom is gone,
// so Iconify's setState reaches react-dom, which touches `window` and throws
// `ReferenceError: window is not defined`. Vitest reports that as an unhandled error
// and fails the run with every test passing — a CI-only flake that depends on how
// long the run takes.
//
// The app never queries the API either: `preloadIcons()` registers every collection
// from bundled packages. An inert API module makes tests match, and stops the suite
// reaching the network at all. Icons render as an empty <span>, exactly as they do
// today when the query never resolves in time.
_api.setAPIModule("", { prepare: () => [], send: () => {} });
