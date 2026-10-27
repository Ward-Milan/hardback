import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import Menulet from "./Menulet";
import "./styles.css";

const isMenulet =
  window.location.hash === "#menulet" ||
  window.location.search.includes("menulet");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isMenulet ? <Menulet /> : <App />}
  </React.StrictMode>
);

