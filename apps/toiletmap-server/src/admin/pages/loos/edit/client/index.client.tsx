/** @jsxImportSource hono/jsx/dom */

import { render } from "hono/jsx/dom";
import { EditLooApp } from "./EditLooApp.client";

const hideServerShell = () => {
  const shell = document.querySelector("[data-loo-edit-shell]");
  if (shell && shell instanceof HTMLElement) {
    shell.style.display = "none";
  }
};

if (typeof window !== "undefined") {
  const mount = () => {
    hideServerShell();
    const root = document.getElementById("loo-edit-root");
    if (!root) {
      console.error("Edit form root not found");
      return;
    }
    render(<EditLooApp />, root);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
}
