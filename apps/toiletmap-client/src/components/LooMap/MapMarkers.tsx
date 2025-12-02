import L from "leaflet";
import ngeohash from "ngeohash";
import { useEffect, useRef } from "preact/hooks";
import Supercluster from "supercluster";
import { getLooById } from "../../api/loos";
import type { CompressedLoo } from "./useMapData";

interface MapMarkersProps {
  map: L.Map | null;
  data: CompressedLoo[];
  apiUrl: string;
}

export default function MapMarkers({ map, data, apiUrl }: MapMarkersProps) {
  const markers = useRef<L.LayerGroup | null>(null);
  const index = useRef<Supercluster | null>(null);

  useEffect(() => {
    if (!map) return;

    markers.current = L.layerGroup().addTo(map);
    index.current = new Supercluster({
      radius: 40,
      maxZoom: 16,
    });

    map.on("moveend", updateMap);

    return () => {
      map.off("moveend", updateMap);
      markers.current?.clearLayers();
      markers.current = null;
    };
  }, [map]);

  useEffect(() => {
    if (!data.length || !index.current) return;

    const points = data.map((loo) => {
      const { latitude, longitude } = ngeohash.decode(loo[1]);
      return {
        type: "Feature" as const,
        properties: { id: loo[0], mask: loo[2] },
        geometry: {
          type: "Point" as const,
          coordinates: [longitude, latitude],
        },
      };
    });

    index.current.load(points);
    updateMap();
  }, [data]);

  const updateMap = () => {
    const mapInstance = map;
    const clusterIndex = index.current;
    const markerLayer = markers.current;

    if (!mapInstance || !clusterIndex || !markerLayer) return;

    const bounds = mapInstance.getBounds();
    const bbox: [number, number, number, number] = [
      bounds.getWest(),
      bounds.getSouth(),
      bounds.getEast(),
      bounds.getNorth(),
    ];
    const zoom = Math.floor(mapInstance.getZoom());

    const clusters = clusterIndex.getClusters(bbox, zoom);
    markerLayer.clearLayers();

    clusters.forEach((cluster) => {
      const [lng, lat] = cluster.geometry.coordinates;
      const isCluster = cluster.properties.cluster;

      if (isCluster) {
        const count = cluster.properties.point_count as number;
        const size = count < 100 ? "small" : count < 1000 ? "medium" : "large";

        // Use design system colors/styles via classes if possible, or inline styles matching tokens
        // Since we can't easily use CSS modules or styled-components here without setup,
        // we'll use the classNames and ensure global CSS (or a new CSS file) covers them.
        // We'll also add some inline styles for the dynamic parts or fallback.

        const icon = L.divIcon({
          html: `<div><span>${count}</span></div>`,
          className: `marker-cluster marker-cluster-${size}`,
          iconSize: new L.Point(40, 40),
        });

        L.marker([lat, lng], { icon })
          .addTo(markerLayer)
          .on("click", () => {
            const expansionZoom = clusterIndex.getClusterExpansionZoom(cluster.id as number);
            mapInstance.flyTo([lat, lng], expansionZoom);
          });
      } else {
        const marker = L.marker([lat, lng]).addTo(markerLayer);
        marker.on("click", async () => {
          const id = cluster.properties.id as string;
          console.log(`Clicked loo: ${id}`);
          const details = await getLooById(apiUrl, id);
          console.log("Loo details:", details);
          if (details) {
            marker
              .bindPopup(`
                   <div>
                     <strong>${details.name || "Toilet"}</strong><br/>
                     ID: ${details.id}<br/>
                     <small>Data fetched & cached!</small>
                   </div>
                 `)
              .openPopup();
          }
        });
      }
    });
  };

  return null;
}
