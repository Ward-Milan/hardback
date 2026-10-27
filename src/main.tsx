import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import Menulet from "./Menulet";
import "./styles.css";

// Fallback mock bridge for standalone WebKit preview / testing when outside Tauri runtime
if (typeof window !== "undefined" && !(window as any).__TAURI_INTERNALS__) {
  (window as any).__TAURI_INTERNALS__ = {
    invoke: async (cmd: string) => {
      if (cmd === "get_storage_devices") {
        return [
          {
            id: "sd-1",
            name: "SD_CAM_A01",
            mountPoint: "/Volumes/SD_CAM_A01",
            fileSystem: "exFAT",
            totalBytes: 128 * 1024 * 1024 * 1024,
            availableBytes: 38.5 * 1024 * 1024 * 1024,
            usedBytes: 89.5 * 1024 * 1024 * 1024,
            isRemovable: true,
            deviceType: "sd_card",
            protocolLabel: "SDXC UHS-II (V90)",
          },
          {
            id: "ssd-1",
            name: "SSD_BACKUP_01",
            mountPoint: "/Volumes/SSD_BACKUP_01",
            fileSystem: "APFS",
            totalBytes: 2 * 1024 * 1024 * 1024 * 1024,
            availableBytes: 1.45 * 1024 * 1024 * 1024 * 1024,
            usedBytes: 0.55 * 1024 * 1024 * 1024 * 1024,
            isRemovable: true,
            deviceType: "ssd",
            protocolLabel: "Thunderbolt 4 / NVMe",
          },
        ];
      }
      if (cmd === "get_app_settings") {
        return {
          smartCascading: true,
          fastInlineVerifyOnly: false,
          turboIo: true,
          ignoreJunkFiles: false,
          ignoreCameraProxies: false,
          writeReportsOnDisk: false,
          sortByMediaType: false,
          moveModeDeleteSource: false,
          autoEjectSource: false,
          soundNotification: true,
          webhookUrl: "",
          hashAlgorithm: "xxh64",
          launchAtStartup: false,
        };
      }
      if (cmd === "get_active_transfers") return [];
      if (cmd === "get_ingest_history") return [];
      return null;
    },
    transformCallback: () => 0,
    plugins: {},
  };
}

const isMenulet =
  window.location.hash === "#menulet" ||
  window.location.search.includes("menulet");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isMenulet ? <Menulet /> : <App />}
  </React.StrictMode>
);

