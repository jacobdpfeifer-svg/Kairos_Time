/* Reviewer: React entry. Mounts the workspace and loads Notebook CSS before any view. */
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./fonts.css";
import "../../design-system/kairos/motion.css";
import "./styles.css";
import "./spatial.css";
import "./notebook.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
