import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import { useEffect, useRef, useState } from "preact/hooks";
import DevTools from "../DevTools";
import DevToolsButton from "../DevToolsButton";
import SettingsPanel from "../SettingsPanel";
import "./LooMap.css";
import MapMarkers from "./MapMarkers";
import { useMapData } from "./useMapData";

interface LooMapProps {
  apiUrl: string;
}

export default function LooMap({ apiUrl }: LooMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const { data } = useMapData(apiUrl);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState("");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDevToolsOpen, setIsDevToolsOpen] = useState(false);

  // Check if we're in development or preview environment
  const isDev = import.meta.env.DEV || import.meta.env.MODE === "preview";

  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    // Initialize map
    map.current = L.map(mapContainer.current).setView([51.505, -0.09], 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map.current);

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  const handleDownload = async () => {
    setDownloading(true);
    setProgress("Starting...");

    try {
      await import("../../api/loos").then(({ fetchRichDump }) =>
        fetchRichDump(apiUrl, (fetched: number, total: number) => {
          setProgress(`${Math.round((fetched / total) * 100)}%`);
        }),
      );
      setProgress("Done!");
      setTimeout(() => {
        setDownloading(false);
      }, 2000);
    } catch (err) {
      console.error(err);
      setProgress("Error");
      setDownloading(false);
    }
  };

  return (
    <div className="loo-map-container">
      <button
        type="button"
        className="settings-btn"
        onClick={() => setIsSettingsOpen(true)}
        title="Settings"
        aria-label="Open Settings"
      >
        <i className="fa-solid fa-cog" />
      </button>

      {isDev && <DevToolsButton onClick={() => setIsDevToolsOpen(true)} />}

      <SettingsPanel
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onDownloadOffline={handleDownload}
        isDownloading={downloading}
        downloadProgress={progress}
        onOpenDevTools={() => {
          setIsSettingsOpen(false);
          setIsDevToolsOpen(true);
        }}
      />

      <DevTools
        isOpen={isDevToolsOpen}
        onClose={() => setIsDevToolsOpen(false)}
        mapInstance={map.current}
      />

      <div id="map" ref={mapContainer} style={{ height: "100vh", width: "100%" }} />
      <MapMarkers map={map.current} data={data} apiUrl={apiUrl} />
    </div>
  );
}
