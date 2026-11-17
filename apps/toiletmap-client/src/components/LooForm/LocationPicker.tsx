import L from "leaflet";
import { useEffect, useRef, useState } from "preact/hooks";
import { Button } from "toiletmap-design-system";
import { isValidLatLng, type LatLng } from "./geometry";
import styles from "./LooForm.module.css";
import { shouldOfferLocationReset, shouldShowCrosshair } from "./pinActions";

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

const DEFAULT_CENTER: L.LatLngExpression = [51.505, -0.09];
const DEFAULT_ZOOM = 13;
const PLACED_ZOOM = 17;

interface LocationPickerProps {
  /** Current pin position, or null when no pin has been placed yet. */
  location: LatLng | null;
  onChange: (lat: number, lng: number) => void;
  /**
   * The saved location when editing an existing toilet. When set and the pin has moved away
   * from it, a "Reset to original location" action is offered.
   */
  originalLocation?: LatLng | null;
  /** Receives the picker's Leaflet map (and null on unmount) so callers can pan it. */
  onMapReady?: (map: L.Map | null) => void;
}

const round6 = (n: number) => Number(n.toFixed(6));

export default function LocationPicker({
  location,
  onChange,
  originalLocation,
  onMapReady,
}: LocationPickerProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  // Keep the latest callbacks in refs so Leaflet handlers never see a stale closure.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onMapReadyRef = useRef(onMapReady);
  onMapReadyRef.current = onMapReady;
  // Whether the centre crosshair is shown (no pin yet, or the pin is away from the map centre).
  const [crosshairVisible, setCrosshairVisible] = useState(true);

  // Uses only refs and a state setter, so it is safe to register once as a Leaflet handler.
  const refreshCrosshair = () => {
    const map = mapRef.current;
    if (!map) return;
    const marker = markerRef.current;
    const size = map.getSize();
    const markerPoint = marker ? map.latLngToContainerPoint(marker.getLatLng()) : null;
    setCrosshairVisible(shouldShowCrosshair(markerPoint, { x: size.x / 2, y: size.y / 2 }));
  };

  const updateMarker = (latitude: number, longitude: number) => {
    const map = mapRef.current;
    if (!map || !isValidLatLng(latitude, longitude)) return;
    if (markerRef.current) {
      markerRef.current.setLatLng([latitude, longitude]);
    } else {
      markerRef.current = L.marker([latitude, longitude], { draggable: true })
        .addTo(map)
        .on("drag", refreshCrosshair)
        .on("dragend", (e) => {
          const pos = (e.target as L.Marker).getLatLng();
          onChangeRef.current(round6(pos.lat), round6(pos.lng));
        });
    }
  };

  const removeMarker = () => {
    markerRef.current?.remove();
    markerRef.current = null;
  };

  useEffect(() => {
    if (!container.current || mapRef.current) return;
    const hasLocation = !!location && isValidLatLng(location.lat, location.lng);
    const map = L.map(container.current).setView(
      hasLocation ? [location.lat, location.lng] : DEFAULT_CENTER,
      hasLocation ? PLACED_ZOOM : DEFAULT_ZOOM,
    );
    mapRef.current = map;
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    // No click handler: the pin only moves by dragging it or via the explicit buttons below.
    if (hasLocation) updateMarker(location.lat, location.lng);
    map.on("move zoom resize", refreshCrosshair);
    refreshCrosshair();
    onMapReadyRef.current?.(map);
    return () => {
      onMapReadyRef.current?.(null);
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!location || !isValidLatLng(location.lat, location.lng)) {
      removeMarker();
      refreshCrosshair();
      return;
    }
    updateMarker(location.lat, location.lng);
    if (map.getCenter().distanceTo([location.lat, location.lng]) > 500) {
      map.setView([location.lat, location.lng], map.getZoom());
    }
    refreshCrosshair();
  }, [location?.lat, location?.lng]);

  const placePinAtCentre = () => {
    const map = mapRef.current;
    if (!map) return;
    const centre = map.getCenter();
    onChangeRef.current(round6(centre.lat), round6(centre.lng));
  };

  const showReset = shouldOfferLocationReset(originalLocation, location);

  const resetToOriginal = () => {
    const map = mapRef.current;
    if (!originalLocation || !isValidLatLng(originalLocation.lat, originalLocation.lng)) return;
    // Unrounded, so the form sees no location change at all.
    onChangeRef.current(originalLocation.lat, originalLocation.lng);
    map?.setView(
      [originalLocation.lat, originalLocation.lng],
      Math.max(map.getZoom(), PLACED_ZOOM),
    );
  };

  return (
    <div>
      <div class={styles.pickerWrap}>
        <div class={styles.pickerMap} ref={container} />
        {(!location || crosshairVisible) && <span class={styles.crosshair} aria-hidden="true" />}
      </div>
      <div class={styles.placePin}>
        <p class={styles.hint}>
          {location
            ? "Drag the pin to fine-tune. To move it further, search or move the map so the toilet is in the centre, then move the pin there."
            : "Move the map so the toilet is in the centre, then place the pin. You can drag it afterwards to fine-tune."}
        </p>
        <Button htmlElement="button" type="button" variant="secondary" onClick={placePinAtCentre}>
          {location ? "Move pin to centre of map" : "Place pin here"}
        </Button>
        {showReset && (
          <button type="button" class={styles.linkButton} onClick={resetToOriginal}>
            Reset to original location
          </button>
        )}
      </div>
    </div>
  );
}
