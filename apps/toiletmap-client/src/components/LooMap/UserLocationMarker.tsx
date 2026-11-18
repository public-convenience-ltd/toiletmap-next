import L from "leaflet";
import { useEffect, useRef } from "preact/hooks";
import type { UserLocation } from "./useUserLocation";

/** Accuracy rings wider than this (m) say little and cover the map, so they aren't drawn. */
const MAX_ACCURACY_RING_M = 500;

let dotIcon: L.DivIcon | null = null;
const getDotIcon = () => {
  dotIcon ??= L.divIcon({
    className: "user-location-marker",
    html: '<span class="user-location-marker__dot" aria-hidden="true"></span>',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
  return dotIcon;
};

interface UserLocationMarkerProps {
  map: L.Map | null;
  location: UserLocation | null;
}

/**
 * The "you are here" dot (and, when the fix is reasonably precise, its accuracy ring). It
 * ignores taps and keyboard focus, so it never gets in the way of the toilet markers under it.
 */
export default function UserLocationMarker({ map, location }: UserLocationMarkerProps) {
  const dotRef = useRef<L.Marker | null>(null);
  const ringRef = useRef<L.Circle | null>(null);

  useEffect(() => {
    if (!map) return;
    return () => {
      if (dotRef.current) map.removeLayer(dotRef.current);
      if (ringRef.current) map.removeLayer(ringRef.current);
      dotRef.current = null;
      ringRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    if (!map) return;
    if (!location) {
      if (dotRef.current) map.removeLayer(dotRef.current);
      if (ringRef.current) map.removeLayer(ringRef.current);
      dotRef.current = null;
      ringRef.current = null;
      return;
    }
    const latlng: [number, number] = [location.lat, location.lng];
    if (dotRef.current) {
      dotRef.current.setLatLng(latlng);
    } else {
      dotRef.current = L.marker(latlng, {
        icon: getDotIcon(),
        interactive: false,
        keyboard: false,
        // Below the toilet markers: the toilet the viewer is standing at stays tappable.
        zIndexOffset: -1000,
      }).addTo(map);
    }

    const accuracy = location.accuracy;
    const showRing =
      typeof accuracy === "number" && accuracy > 0 && accuracy <= MAX_ACCURACY_RING_M;
    if (showRing && ringRef.current) {
      ringRef.current.setLatLng(latlng);
      ringRef.current.setRadius(accuracy);
    } else if (showRing) {
      ringRef.current = L.circle(latlng, {
        radius: accuracy,
        interactive: false,
        className: "user-location-accuracy",
        weight: 1,
        color: "#1a73e8",
        fillColor: "#1a73e8",
        fillOpacity: 0.12,
      }).addTo(map);
    } else if (ringRef.current) {
      map.removeLayer(ringRef.current);
      ringRef.current = null;
    }
  }, [map, location]);

  return null;
}
