/** @jsxImportSource hono/jsx/dom */

import { useEffect, useRef } from "hono/jsx";
import L from "leaflet";

type Props = {
  lat: number;
  lng: number;
  onChange: (lat: number, lng: number) => void;
};

export const LocationMapPicker = ({ lat, lng, onChange }: Props) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const markerInstance = useRef<L.Marker | null>(null);

  // Fix for Leaflet default icon issues in bundlers
  useEffect(() => {
    (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl = undefined;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
      iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
      shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
    });
  }, []);

  useEffect(() => {
    if (!mapContainer.current) return;

    // Initialize map if not exists
    if (!mapInstance.current) {
      const center = [lat || 51.505, lng || -0.09] as L.LatLngExpression;
      mapInstance.current = L.map(mapContainer.current).setView(center, 13);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(mapInstance.current);

      // Add click handler to map
      mapInstance.current.on("click", (e) => {
        const { lat, lng } = e.latlng;
        updateMarker(lat, lng);
        onChange(Number(lat.toFixed(6)), Number(lng.toFixed(6)));
      });
    }

    // Update or create marker
    updateMarker(lat, lng);

    // Cleanup
    return () => {
      // We don't destroy the map here to avoid issues with Hono's re-rendering
      // but in a full React app we might.
      // For now, let's just keep the instance.
    };
  }, []); // Run once on mount

  // Effect to update marker when props change
  useEffect(() => {
    if (mapInstance.current && lat !== undefined && lng !== undefined) {
      updateMarker(lat, lng);
      // Only pan if significantly different to avoid fighting the user
      const currentCenter = mapInstance.current.getCenter();
      const dist = currentCenter.distanceTo([lat, lng]);
      if (dist > 1000) {
        // 1km
        mapInstance.current.setView([lat, lng], mapInstance.current.getZoom());
      }
    }
  }, [lat, lng]);

  const updateMarker = (latitude: number, longitude: number) => {
    if (!mapInstance.current) return;

    if (markerInstance.current) {
      markerInstance.current.setLatLng([latitude, longitude]);
    } else {
      markerInstance.current = L.marker([latitude, longitude], { draggable: true })
        .addTo(mapInstance.current)
        .on("dragend", (event) => {
          const marker = event.target;
          const position = marker.getLatLng();
          onChange(Number(position.lat.toFixed(6)), Number(position.lng.toFixed(6)));
        });
    }
  };

  return (
    <div class="map-picker-container">
      <div
        ref={mapContainer}
        class="map-container"
        style="height: 400px; width: 100%; border-radius: 8px; z-index: 1;"
      />
      <p class="field-hint" style="margin-top: var(--space-xs);">
        Click on the map or drag the marker to set the location.
      </p>
    </div>
  );
};
