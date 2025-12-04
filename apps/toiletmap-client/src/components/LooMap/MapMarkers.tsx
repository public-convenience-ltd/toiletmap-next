import L from "leaflet";
import "leaflet.markercluster";
import ngeohash from "ngeohash";
import { useEffect, useRef } from "preact/hooks";
import { getLooById, getLoosByIds } from "../../api/loos";
import type { CompressedLoo } from "./useMapData";

interface MapMarkersProps {
  map: L.Map | null;
  data: CompressedLoo[];
  apiUrl: string;
}

export default function MapMarkers({ map, data, apiUrl }: MapMarkersProps) {
  const markerClusterGroup = useRef<L.MarkerClusterGroup | null>(null);

  // Prefetch logic
  useEffect(() => {
    if (!map || !data.length) return;

    const onMoveEnd = async () => {
      const bounds = map.getBounds();
      const visibleIds: string[] = [];

      // Find loos within current viewport
      // Optimization: We could use a spatial index here, but iterating 400kb of data (approx 14k loos)
      // is surprisingly fast in JS. If it becomes slow, we can use a quadtree.
      // For now, simple iteration is likely sufficient given the "compressed" format is just an array.
      for (const loo of data) {
        const { latitude, longitude } = ngeohash.decode(loo[1]);
        if (bounds.contains([latitude, longitude])) {
          visibleIds.push(loo[0]);
        }
      }

      console.log(`Found ${visibleIds.length} loos in viewport`);

      // Limit to a reasonable number to prefetch (e.g., 50 closest or just first 50)
      // For now, let's just take the first 50 to avoid hammering the API if zoomed out too far
      const idsToFetch = visibleIds.slice(0, 50);

      if (idsToFetch.length > 0) {
        await getLoosByIds(apiUrl, idsToFetch);
      }
    };

    map.on("moveend", onMoveEnd);

    // Trigger once on initial load if data is available
    onMoveEnd();

    return () => {
      map.off("moveend", onMoveEnd);
    };
  }, [map, data, apiUrl]);

  useEffect(() => {
    if (!map) return;

    // Initialize MarkerClusterGroup
    markerClusterGroup.current = L.markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 80, // More aggressive clustering
      animate: true,
      animateAddingMarkers: true,
      iconCreateFunction: (cluster) => {
        const count = cluster.getChildCount();
        let size = "small";
        if (count > 100) size = "medium";
        if (count > 1000) size = "large";

        return L.divIcon({
          html: `<div><span>${count}</span></div>`,
          className: `marker-cluster marker-cluster-${size}`,
          iconSize: new L.Point(40, 40),
        });
      },
    });

    map.addLayer(markerClusterGroup.current);

    return () => {
      if (markerClusterGroup.current) {
        map.removeLayer(markerClusterGroup.current);
        markerClusterGroup.current = null;
      }
    };
  }, [map]);

  useEffect(() => {
    if (!data.length || !markerClusterGroup.current) return;

    const markers: L.Marker[] = [];

    data.forEach((loo) => {
      const { latitude, longitude } = ngeohash.decode(loo[1]);
      const id = loo[0];

      const getIconString = (isHighlighted: boolean) => `
          <svg viewBox="-1 -1 21 33" height="33" width="21" xmlns="http://www.w3.org/2000/svg">
            <path d="M10 0C4.47632 0 0 4.47529 0 10C0 19.5501 10 32 10 32C10 32 20 19.5501 20 10C20 4.47529 15.5237 0 10 0Z" fill="#ED3D63" stroke="white"/>
            ${
              isHighlighted
                ? '<path d="M10 4L11.7634 7.57295L15.7063 8.1459L12.8532 10.9271L13.5267 14.8541L10 13L6.47329 14.8541L7.14683 10.9271L4.29366 8.1459L8.23664 7.57295L10 4Z" fill="white"/>'
                : '<circle cx="10" cy="10" r="5" fill="white"/>'
            }
          </svg>
        `;

      const icon = L.divIcon({
        html: getIconString(false),
        className: "loo-marker",
        iconSize: [21, 33],
        iconAnchor: [10.5, 33],
        popupAnchor: [0, -33],
      });

      const marker = L.marker([latitude, longitude], { icon });

      marker.on("click", async () => {
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

      markers.push(marker);
    });

    markerClusterGroup.current.clearLayers();
    markerClusterGroup.current.addLayers(markers);
  }, [data, apiUrl]);

  return null;
}
