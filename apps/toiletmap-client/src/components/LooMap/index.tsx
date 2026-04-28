import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import { useEffect, useRef, useState } from "preact/hooks";
import type { LooDetail } from "../../api/loos";
import { type ActiveFilters, DEFAULT_FILTERS, type FilterKey } from "../../types/filters";
import DevTools from "../DevTools";
import DevToolsButton from "../DevToolsButton";
import MapControlsPanel from "../MapControlsPanel";
import SettingsPanel from "../SettingsPanel";
import ToiletDetailsPanel from "../ToiletDetailsPanel";
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
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDevToolsOpen, setIsDevToolsOpen] = useState(false);
  const [selectedToilet, setSelectedToilet] = useState<LooDetail | null>(null);

  const [activeFilters, setActiveFilters] = useState<ActiveFilters>(DEFAULT_FILTERS);

  const handleFilterChange = (key: FilterKey, value: boolean) => {
    setActiveFilters((prev) => ({ ...prev, [key]: value }));
  };

  const handleResetFilters = () => {
    setActiveFilters(DEFAULT_FILTERS);
  };

  const isDev = import.meta.env.DEV || import.meta.env.MODE === "preview";

  useEffect(() => {
    if (!mapContainer.current || map.current) return;

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

  return (
    <div className="loo-map-container">
      <MapControlsPanel
        mapRef={map}
        activeFilters={activeFilters}
        onFilterChange={handleFilterChange}
        onResetFilters={handleResetFilters}
      />

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
      <MapMarkers
        map={map.current}
        data={data}
        activeFilters={activeFilters}
        apiUrl={apiUrl}
        onToiletSelect={setSelectedToilet}
      />
      {selectedToilet && (
        <ToiletDetailsPanel toilet={selectedToilet} onClose={() => setSelectedToilet(null)} />
      )}
    </div>
  );
}
