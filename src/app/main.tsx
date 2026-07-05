import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "@/styles/globals.css";
import "@/i18n";
import { preloadIcons } from "@/utils/icons";
import { installGlobalErrorLogging, installInvokeTiming } from "@/lib/logger";

preloadIcons();

installInvokeTiming();
installGlobalErrorLogging();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
