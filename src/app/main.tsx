import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "@/styles/globals.css";
import "@/i18n";
import { preloadIcons } from "@/utils/icons";
import { installGlobalErrorLogging, installMainThreadHeartbeat } from "@/lib/logger";
import { startupPing } from "@/services/diagnostics";

startupPing("main.tsx entered");
installMainThreadHeartbeat();
preloadIcons();
startupPing("preloadIcons done");

installGlobalErrorLogging();

startupPing("react render START");
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
startupPing("react render dispatched");
