import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import { useEffect, useRef, useState } from "preact/hooks";
import { IconButton } from "toiletmap-design-system";
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
  initialToiletId?: string;
}

export default function LooMap({ apiUrl, initialToiletId }: LooMapProps) {
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
  // True while we're waiting for the initial toilet from the URL to load
  const isInitialLoading = useRef(!!initialToiletId);

  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    map.current = L.map(mapContainer.current, { zoomControl: false }).setView([51.505, -0.09], 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map.current);

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Pre-select toilet when navigating directly to /loo/{id}
  useEffect(() => {
    if (!initialToiletId) return;
    import("../../api/loos").then(({ getLooById }) => {
      getLooById(apiUrl, initialToiletId).then((detail) => {
        isInitialLoading.current = false;
        if (detail) setSelectedToilet(detail);
      });
    });
  }, [apiUrl, initialToiletId]);

  // Update URL to reflect selected toilet without a full page reload.
  // Skip while the initial toilet is still loading to avoid a flash to "/".
  useEffect(() => {
    if (isInitialLoading.current) return;
    if (selectedToilet) {
      history.pushState(null, "", `/loo/${selectedToilet.id}`);
    } else {
      history.replaceState(null, "", "/");
    }
  }, [selectedToilet]);

  return (
    <div className="loo-map-container">
      <MapControlsPanel
        mapRef={map}
        activeFilters={activeFilters}
        onFilterChange={handleFilterChange}
        onResetFilters={handleResetFilters}
      />

      <IconButton
        icon="gear"
        aria-label="Open settings"
        variant="filled"
        class="settings-btn"
        onClick={() => setIsSettingsOpen(true)}
      />

      {isDev && <DevToolsButton class="dev-tools-btn" onClick={() => setIsDevToolsOpen(true)} />}

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

      <div id="map" ref={mapContainer} style={{ height: "100%", width: "100%" }} />
      <MapMarkers
        map={map.current}
        data={data}
        activeFilters={activeFilters}
        apiUrl={apiUrl}
        selectedToiletId={selectedToilet?.id ?? null}
        onToiletSelect={setSelectedToilet}
      />

      {selectedToilet && (
        <div className="toilet-panel">
          <ToiletDetailsPanel
            key={selectedToilet.id}
            toilet={selectedToilet}
            onClose={() => setSelectedToilet(null)}
          />
        </div>
      )}
    </div>
  );
}
