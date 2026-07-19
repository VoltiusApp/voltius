import React from "react";
import ReactDOM from "react-dom/client";
import { polyfillCountryFlagEmojis } from "country-flag-emoji-polyfill";
import App from "./App";
import "@/styles/globals.css";
import "@/i18n";
import { preloadIcons } from "@/utils/icons";
import { installGlobalErrorLogging } from "@/lib/logger";

// Chromium/WebView2 on Windows can't render country flag emoji natively
// (regional indicator pairs show as letter codes, e.g. "DE"); this loads a
// self-hosted font subset only when the OS lacks native flag support.
polyfillCountryFlagEmojis(undefined, "/fonts/TwemojiCountryFlags.woff2");

preloadIcons();

installGlobalErrorLogging();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
