import React from "react";
import ReactDOM from "react-dom/client";
import { polyfillCountryFlagEmojis } from "country-flag-emoji-polyfill";
import App from "./App";
import "@/styles/globals.css";
import { i18nReady } from "@/i18n";
import { preloadIcons } from "@/utils/icons";
import { installGlobalErrorLogging } from "@/lib/logger";
import { registerMcpConsumer } from "@/mcp/register";

// Chromium/WebView2 on Windows can't render country flag emoji natively
// (regional indicator pairs show as letter codes, e.g. "DE"); this loads a
// self-hosted font subset only when the OS lacks native flag support.
polyfillCountryFlagEmojis(undefined, "/fonts/TwemojiCountryFlags.woff2");

preloadIcons();

installGlobalErrorLogging();

registerMcpConsumer();

// App Store screenshot build only (scripts/ios-e2e/store.mjs): the harness
// calls window.__voltiusDemoSeed() to fill the vault with demo hosts.
if (import.meta.env.VITE_DEMO_SEED === "1") {
  void import("@/services/demoSeed").then((m) => {
    (window as Window & { __voltiusDemoSeed?: () => Promise<string> }).__voltiusDemoSeed = m.seedDemo;
  });
}

void i18nReady.then(() =>
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  ),
);
