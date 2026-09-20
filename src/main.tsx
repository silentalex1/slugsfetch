import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

const root = document.documentElement;
let theme = "dark";

try {
  const savedSettings = localStorage.getItem("slugfetch-settings");
  if (savedSettings) {
    const settings = JSON.parse(savedSettings);
    theme = settings.theme || "dark";
  }
} catch {
  theme = "dark";
}

if (theme === "auto") {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  root.classList.toggle("dark", prefersDark);
  root.style.colorScheme = prefersDark ? "dark" : "light";
} else {
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme === "dark" ? "dark" : "light";
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
