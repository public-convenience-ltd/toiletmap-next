import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import { useEffect, useRef } from "preact/hooks";
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

  return (
    <div className="loo-map-container">
      <div id="map" ref={mapContainer} style={{ height: "100vh", width: "100%" }} />
      <MapMarkers map={map.current} data={data} apiUrl={apiUrl} />
    </div>
  );
}
