import L from "leaflet";
import { useEffect, useRef } from "preact/hooks";

// Leaflet bundler fix: deleting _getIconUrl is required because setting it to undefined
// causes a TypeError when Leaflet calls it as a function.
// biome-ignore lint/performance/noDelete: intentional — undefined breaks Leaflet
// biome-ignore lint/suspicious/noExplicitAny: prototype access requires any
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

interface LocationPickerProps {
  lat: number;
  lng: number;
  onChange: (lat: number, lng: number) => void;
}

export default function LocationPicker({ lat, lng, onChange }: LocationPickerProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  const updateMarker = (latitude: number, longitude: number) => {
    if (!mapRef.current) return;
    if (markerRef.current) {
      markerRef.current.setLatLng([latitude, longitude]);
    } else {
      markerRef.current = L.marker([latitude, longitude], { draggable: true })
        .addTo(mapRef.current)
        .on("dragend", (e) => {
          const pos = (e.target as L.Marker).getLatLng();
          onChange(Number(pos.lat.toFixed(6)), Number(pos.lng.toFixed(6)));
        });
    }
  };

  useEffect(() => {
    if (!container.current || mapRef.current) return;
    const center: L.LatLngExpression = [lat || 51.505, lng || -0.09];
    mapRef.current = L.map(container.current).setView(center, 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(mapRef.current);
    mapRef.current.on("click", (e) => {
      onChange(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6)));
    });
    updateMarker(lat || 51.505, lng || -0.09);
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !lat || !lng) return;
    updateMarker(lat, lng);
    const cur = mapRef.current.getCenter();
    if (cur.distanceTo([lat, lng]) > 500) {
      mapRef.current.setView([lat, lng], mapRef.current.getZoom());
    }
  }, [lat, lng]);

  return (
    <div>
      <div
        ref={container}
        style={{ height: "360px", width: "100%", borderRadius: "8px", zIndex: 1 }}
      />
      <p
        style={{
          fontSize: "var(--text--2)",
          color: "var(--color-neutral-grey)",
          marginTop: "var(--space-2xs)",
        }}
      >
        Click the map or drag the pin to set the exact location.
      </p>
    </div>
  );
}
