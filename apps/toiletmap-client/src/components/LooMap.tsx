import L from "leaflet";
import { useEffect, useRef } from "preact/hooks";
import "leaflet/dist/leaflet.css";
import { get, set } from "idb-keyval";
import Supercluster from "supercluster";
import { getLooById } from "../api/loos";

const CACHE_KEY = "loos-cache";
const CACHE_TIME_KEY = "loos-cache-time";
const CACHE_DURATION = 1000 * 60 * 60; // 1 hour

type CompressedLoo = [string, string, number]; // id, geohash, filterMask

export default function LooMap() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markers = useRef<L.LayerGroup | null>(null);
  const index = useRef<Supercluster | null>(null);

  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    // Initialize map
    map.current = L.map(mapContainer.current).setView([51.505, -0.09], 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map.current);

    markers.current = L.layerGroup().addTo(map.current);

    // Initialize Supercluster
    index.current = new Supercluster({
      radius: 40,
      maxZoom: 16,
    });

    // Load data
    loadData();

    // Event listeners
    map.current.on("moveend", updateMap);

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  const loadData = async () => {
    try {
      let data: CompressedLoo[] | undefined = await get(CACHE_KEY);
      const cacheTime = await get(CACHE_TIME_KEY);
      const now = Date.now();

      if (!data || !cacheTime || now - cacheTime > CACHE_DURATION) {
        console.log("Fetching fresh data...");
        const response = await fetch("http://localhost:8787/api/loos/dump");
        const json = await response.json();
        data = json.data;
        await set(CACHE_KEY, data);
        await set(CACHE_TIME_KEY, now);
      } else {
        console.log("Using cached data");
      }

      if (data && index.current) {
        const points = data.map((loo) => ({
          type: "Feature" as const,
          properties: { id: loo[0], mask: loo[2] },
          geometry: {
            type: "Point" as const,
            coordinates: decodeGeohash(loo[1]),
          },
        }));

        index.current.load(points);
        updateMap();
      }
    } catch (error) {
      console.error("Failed to load map data:", error);
    }
  };

  const updateMap = () => {
    const mapInstance = map.current;
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
        const count = cluster.properties.point_count;
        const size = count < 100 ? "small" : count < 1000 ? "medium" : "large";
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
          const details = await getLooById(id);
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

  // Helper to decode geohash to [lng, lat]
  // Note: This is a simplified decoder. For production, use a library or the existing server-side logic if portable.
  // For this proof of concept, I'll include a basic implementation.
  const decodeGeohash = (geohash: string): [number, number] => {
    // Basic base32 map
    const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";
    let even = true;
    let latMin = -90;
    let latMax = 90;

    let lonMin = -180;
    let lonMax = 180;

    for (let i = 0; i < geohash.length; i++) {
      const chr = geohash.charAt(i);
      const idx = BASE32.indexOf(chr);
      for (let n = 4; n >= 0; n--) {
        const bitN = (idx >> n) & 1;
        if (even) {
          const lonMid = (lonMin + lonMax) / 2;
          if (bitN === 1) {
            lonMin = lonMid;
          } else {
            lonMax = lonMid;
          }
        } else {
          const latMid = (latMin + latMax) / 2;
          if (bitN === 1) {
            latMin = latMid;
          } else {
            latMax = latMid;
          }
        }
        even = !even;
      }
    }
    const lat = (latMin + latMax) / 2;
    const lon = (lonMin + lonMax) / 2;
    return [lon, lat];
  };

  return <div id="map" ref={mapContainer} style={{ height: "500px", width: "100%" }} />;
}
