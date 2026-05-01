import type { ComponentChildren } from "preact";

interface MapOverlayProps {
  children: ComponentChildren;
}

const MapOverlay = ({ children }: MapOverlayProps) => <div class="map-overlay">{children}</div>;

export default MapOverlay;
