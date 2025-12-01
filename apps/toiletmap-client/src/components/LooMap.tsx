import type { LatLngBounds, LayerGroup, Map as LeafletMap, MarkerClusterGroup } from "leaflet";
import iconUrl from "leaflet/dist/images/marker-icon.png";
import iconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import shadowUrl from "leaflet/dist/images/marker-shadow.png";
import type {} from "leaflet.markercluster";
import ngeohash from "ngeohash";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

type LeafletModule = typeof import("leaflet")["default"];

type CompressedLooTuple = [string, string, number];

type LooFeatureFlags = {
  accessible: boolean;
  babyChange: boolean;
  radar: boolean;
  automatic: boolean;
  allGender: boolean;
  noPayment: boolean;
};

type MapLoo = {
  id: string;
  geohash: string;
  lat: number;
  lng: number;
  features: LooFeatureFlags;
};

type TileCacheEntry = {
  fetchedAt: number;
  data: MapLoo[];
};

type StatusState = {
  isLoading: boolean;
  looCount: number;
  tileCount: number;
  precision: number;
  error: string | null;
};

interface LooMapProps {
  apiUrl: string;
}

type FetchMetrics = {
  markersAdded: number;
  markersRemoved: number;
  totalMarkers: number;
  tilesRequested: number;
  cacheHits: number;
  fetchedTiles: number;
  fetchDurationMs: number;
};

const DEFAULT_CENTER: [number, number] = [54.559, -2.11];
const DEFAULT_ZOOM = 6;
const TILE_TTL_MS = 5 * 60 * 1000;
const FETCH_BATCH_SIZE = 4;
const MAX_TILE_REQUESTS = 200;
const MIN_PRECISION = 2;
const VIEWPORT_PADDING = 0.15;
const FETCH_DEBOUNCE_MS = 260;

const PRECISION_BY_ZOOM = [
  { maxZoom: 4, precision: 2 },
  { maxZoom: 6, precision: 3 },
  { maxZoom: 9, precision: 4 },
  { maxZoom: 12, precision: 5 },
  { maxZoom: Number.POSITIVE_INFINITY, precision: 6 },
] as const;

const DEBUG_COLORS = ["#FF8A5B", "#F4B23E", "#06D6A0", "#118AB2", "#9B5DE5"] as const;

const FILTER_MASKS = {
  noPayment: 0b00000001,
  allGender: 0b00000010,
  automatic: 0b00000100,
  accessible: 0b00001000,
  babyChange: 0b00010000,
  radar: 0b00100000,
} as const;

const decodeFilterMask = (mask: number): LooFeatureFlags => ({
  noPayment: Boolean(mask & FILTER_MASKS.noPayment),
  allGender: Boolean(mask & FILTER_MASKS.allGender),
  automatic: Boolean(mask & FILTER_MASKS.automatic),
  accessible: Boolean(mask & FILTER_MASKS.accessible),
  babyChange: Boolean(mask & FILTER_MASKS.babyChange),
  radar: Boolean(mask & FILTER_MASKS.radar),
});

const isEntryFresh = (entry: TileCacheEntry | undefined, now: number) =>
  Boolean(entry && now - entry.fetchedAt <= TILE_TTL_MS);

const deriveFromAncestor = (
  tile: string,
  now: number,
  cache: Map<string, TileCacheEntry>,
): TileCacheEntry | null => {
  for (let prefixLength = tile.length - 1; prefixLength >= MIN_PRECISION; prefixLength -= 1) {
    const ancestor = tile.slice(0, prefixLength);
    const ancestorEntry = cache.get(ancestor);
    if (!isEntryFresh(ancestorEntry, now)) continue;
    const subset = ancestorEntry.data.filter((loo) => loo.geohash.startsWith(tile));
    const derivedEntry: TileCacheEntry = {
      fetchedAt: ancestorEntry.fetchedAt,
      data: subset,
    };
    cache.set(tile, derivedEntry);
    return derivedEntry;
  }
  return null;
};

const getTileCacheEntry = (
  tile: string,
  now: number,
  cache: Map<string, TileCacheEntry>,
): TileCacheEntry | null => {
  const entry = cache.get(tile);
  if (entry && isEntryFresh(entry, now)) return entry;
  if (entry) cache.delete(tile);
  return deriveFromAncestor(tile, now, cache);
};

const describeFeatures = (flags: LooFeatureFlags) => {
  const labels = [] as string[];
  if (flags.accessible) labels.push("Accessible");
  if (flags.noPayment) labels.push("Free");
  if (flags.radar) labels.push("RADAR");
  if (flags.babyChange) labels.push("Baby change");
  if (flags.allGender) labels.push("All gender");
  if (flags.automatic) labels.push("Automatic");
  return labels.join(" · ") || "No feature data";
};

const sanitizeId = (value: string) => value.replace(/[^a-zA-Z0-9-_:.]/g, "");

const getDebugColor = (tile: string) =>
  DEBUG_COLORS[tile.length % DEBUG_COLORS.length] ?? DEBUG_COLORS[0];

const renderPopupHtml = (loo: MapLoo) => {
  const escapedId = sanitizeId(loo.id);
  const featureSummary = describeFeatures(loo.features);
  return `<div class="loo-popup">
    <strong>Loo ${escapedId}</strong>
    <div style="margin-top: 0.25rem; font-size: 0.85rem;">${featureSummary}</div>
    <div style="margin-top: 0.15rem; font-size: 0.75rem; color: #5c6b7c;">Geohash: ${
      loo.geohash
    }</div>
  </div>`;
};

const buildIconSvg = (isHighlighted: boolean) => {
  const glyph = isHighlighted
    ? '<path d="M10 4L11.7634 7.57295L15.7063 8.1459L12.8532 10.9271L13.5267 14.8541L10 13L6.47329 14.8541L7.14683 10.9271L4.29366 8.1459L8.23664 7.57295L10 4Z" fill="white"/>'
    : '<circle cx="10" cy="10" r="5" fill="white"/>';
  return `<svg viewBox="-1 -1 21 33" xmlns="http://www.w3.org/2000/svg" style="width: 100%; height: 100%;">
      <path d="M10 0C4.47632 0 0 4.47529 0 10C0 19.5501 10 32 10 32C10 32 20 19.5501 20 10C20 4.47529 15.5237 0 10 0Z" fill="#ED3D63" stroke="white"/>
      ${glyph}
    </svg>`;
};

const createToiletIcon = (leaflet: LeafletModule, isHighlighted: boolean) =>
  leaflet.divIcon({
    html: buildIconSvg(isHighlighted),
    className: "toilet-marker",
    iconSize: [32, 42],
    iconAnchor: [16, 40],
  });

const getPrecisionForZoom = (zoom: number) => {
  for (const bucket of PRECISION_BY_ZOOM) {
    if (zoom <= bucket.maxZoom) return bucket.precision;
  }
  return PRECISION_BY_ZOOM[PRECISION_BY_ZOOM.length - 1]?.precision ?? 5;
};

const computeTilesForBounds = (bounds: LatLngBounds, zoom: number) => {
  let precision = getPrecisionForZoom(zoom);

  const uniqueTiles = (prec: number) => {
    const southWest = bounds.getSouthWest();
    const northEast = bounds.getNorthEast();
    const rawTiles = ngeohash.bboxes(
      southWest.lat,
      southWest.lng,
      northEast.lat,
      northEast.lng,
      prec,
    );
    return Array.from(new Set(rawTiles));
  };

  let tiles = uniqueTiles(precision);
  while (tiles.length > MAX_TILE_REQUESTS && precision > MIN_PRECISION) {
    precision -= 1;
    tiles = uniqueTiles(precision);
  }

  return { tiles, precision };
};

const getClusterRadius = (zoom: number) => {
  if (zoom >= 16) return 18;
  if (zoom >= 15) return 28;
  if (zoom >= 13) return 50;
  if (zoom >= 11) return 80;
  return 130;
};

const inflateTileData = (tuples: CompressedLooTuple[]): MapLoo[] =>
  tuples.map(([id, geohash, mask]) => {
    const { latitude, longitude } = ngeohash.decode(geohash);
    return {
      id,
      geohash,
      lat: latitude,
      lng: longitude,
      features: decodeFilterMask(mask),
    };
  });

const parseCompressedResponse = (payload: unknown): CompressedLooTuple[] => {
  if (!payload || typeof payload !== "object") throw new Error("Unexpected API response");
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) throw new Error("Malformed compressed payload");

  return data.map((entry) => {
    if (!Array.isArray(entry) || entry.length < 3) throw new Error("Invalid compressed entry");
    const [id, geohash, mask] = entry;
    if (typeof id !== "string" || typeof geohash !== "string" || typeof mask !== "number") {
      throw new Error("Invalid compressed tuple contents");
    }
    return [id, geohash, mask];
  });
};

const loadLeaflet = async (): Promise<LeafletModule> => {
  const [{ default: leaflet }] = await Promise.all([
    import("leaflet"),
    import("leaflet/dist/leaflet.css"),
    import("leaflet.markercluster/dist/MarkerCluster.css"),
    import("leaflet.markercluster/dist/MarkerCluster.Default.css"),
  ]);
  await import("leaflet.markercluster");
  // Fix default icon lookups for bundlers
  // @ts-expect-error - private Leaflet internals
  leaflet.Icon.Default.prototype._getIconUrl = undefined;
  leaflet.Icon.Default.mergeOptions({
    iconRetinaUrl,
    iconUrl,
    shadowUrl,
  });
  return leaflet;
};

export default function LooMap({ apiUrl }: LooMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef<MarkerClusterGroup | null>(null);
  const leafletRef = useRef<LeafletModule | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const tileCacheRef = useRef<Map<string, TileCacheEntry>>(new Map());
  const fetchTimeoutRef = useRef<number | null>(null);
  const fetchViewportRef = useRef<() => void>();
  const isUnmountedRef = useRef(false);
  const debugLayerRef = useRef<LayerGroup | null>(null);
  const lastTilesRef = useRef<string[]>([]);
  const markerIndexRef = useRef<Map<string, ReturnType<LeafletModule["marker"]>>>(new Map());
  const debugMetricsRef = useRef(false);

  const [status, setStatus] = useState<StatusState>({
    isLoading: true,
    looCount: 0,
    tileCount: 0,
    precision: getPrecisionForZoom(DEFAULT_ZOOM),
    error: null,
  });
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [debugMetricsEnabled, setDebugMetricsEnabled] = useState(false);
  const [lastMetrics, setLastMetrics] = useState<FetchMetrics | null>(null);

  const toggleDebugLayer = useCallback(() => {
    setDebugEnabled((prev) => !prev);
  }, []);

  const toggleDebugMetrics = useCallback(() => {
    setDebugMetricsEnabled((prev) => !prev);
  }, []);

  const updateDebugTiles = useCallback(
    (tiles: string[]) => {
      const map = mapRef.current;
      const leaflet = leafletRef.current;
      if (!map || !leaflet) return;

      if (!debugEnabled) {
        if (debugLayerRef.current) {
          debugLayerRef.current.clearLayers();
        }
        return;
      }

      const layer = debugLayerRef.current ?? leaflet.layerGroup().addTo(map);
      debugLayerRef.current = layer;
      layer.clearLayers();

      tiles.forEach((tile) => {
        const [minLat, minLon, maxLat, maxLon] = ngeohash.decode_bbox(tile) as [
          number,
          number,
          number,
          number,
        ];
        const color = getDebugColor(tile);
        const rectangle = leaflet.rectangle(
          [
            [minLat, minLon],
            [maxLat, maxLon],
          ],
          {
            color,
            weight: 1,
            fillColor: color,
            fillOpacity: 0.05,
            dashArray: "4 2",
            interactive: false,
          },
        );

        rectangle.bindTooltip(`${tile} / ${tile.length}`, {
          permanent: true,
          direction: "center",
          className: "geohash-tile-tooltip",
          opacity: 0.7,
        });

        layer.addLayer(rectangle);
      });
    },
    [debugEnabled],
  );

  const scheduleFetch = useCallback(() => {
    if (fetchTimeoutRef.current) {
      window.clearTimeout(fetchTimeoutRef.current);
    }
    fetchTimeoutRef.current = window.setTimeout(() => {
      fetchViewportRef.current?.();
    }, FETCH_DEBOUNCE_MS);
  }, []);

  const fetchViewportLoos = useCallback(async () => {
    const map = mapRef.current;
    const markers = markersRef.current;
    const leaflet = leafletRef.current;
    if (!map || !markers || !leaflet) return;

    const { tiles, precision } = computeTilesForBounds(map.getBounds(), map.getZoom());
    if (!tiles.length) return;

    lastTilesRef.current = tiles;
    updateDebugTiles(tiles);

    const fetchStart = performance.now();
    setStatus((prev) => ({
      ...prev,
      isLoading: true,
      precision,
      tileCount: tiles.length,
      error: null,
    }));

    const now = Date.now();
    const tileData = new Map<string, MapLoo[]>();
    const tilesToFetch: string[] = [];
    let cacheHits = 0;

    tiles.forEach((tile) => {
      const entry = getTileCacheEntry(tile, now, tileCacheRef.current);
      if (entry) {
        tileData.set(tile, entry.data);
        cacheHits += 1;
      } else {
        tilesToFetch.push(tile);
      }
    });

    if (tilesToFetch.length) {
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        for (let i = 0; i < tilesToFetch.length; i += FETCH_BATCH_SIZE) {
          const batch = tilesToFetch.slice(i, i + FETCH_BATCH_SIZE);
          const responses = await Promise.all(
            batch.map(async (tile) => {
              const response = await fetch(
                `${apiUrl}/api/loos/geohash/${tile}?compressed=true&active=true`,
                { signal: controller.signal },
              );
              if (!response.ok) {
                throw new Error(`Failed to fetch tile ${tile} (${response.status})`);
              }
              const tuples = parseCompressedResponse(await response.json());
              return { tile, data: inflateTileData(tuples) };
            }),
          );

          const fetchedAt = Date.now();
          responses.forEach(({ tile, data }) => {
            const entry: TileCacheEntry = { fetchedAt, data };
            tileCacheRef.current.set(tile, entry);
            tileData.set(tile, data);
          });
        }
      } catch (error) {
        if ((error as DOMException).name === "AbortError") {
          return;
        }
        console.error("Error fetching loos:", error);
        if (!isUnmountedRef.current) {
          setStatus((prev) => ({
            ...prev,
            isLoading: false,
            error: (error as Error).message ?? "Unknown error",
          }));
        }
        return;
      } finally {
        abortControllerRef.current = null;
      }
    }

    const aggregated = new Map<string, MapLoo>();
    tileData.forEach((loos) => {
      loos.forEach((loo) => {
        aggregated.set(loo.id, loo);
      });
    });

    const markerIndex = markerIndexRef.current;
    const viewportBounds = map.getBounds().pad(VIEWPORT_PADDING);
    const nextVisibleIds = new Set<string>();
    const markersToAdd: ReturnType<LeafletModule["marker"]>[] = [];
    const markersToRemove: ReturnType<LeafletModule["marker"]>[] = [];

    aggregated.forEach((loo) => {
      if (!viewportBounds.contains([loo.lat, loo.lng])) return;
      nextVisibleIds.add(loo.id);

      if (markerIndex.has(loo.id)) return;

      const marker = leaflet
        .marker([loo.lat, loo.lng], {
          icon: createToiletIcon(leaflet, Boolean(loo.features.accessible)),
          title: `Loo ${loo.id}`,
        })
        .bindPopup(renderPopupHtml(loo));

      markerIndex.set(loo.id, marker);
      markersToAdd.push(marker);
    });

    markerIndex.forEach((marker, id) => {
      if (nextVisibleIds.has(id)) return;
      markersToRemove.push(marker);
      markerIndex.delete(id);
    });

    if (markersToRemove.length) {
      // @ts-expect-error upstream typings miss removeLayers
      markers.removeLayers?.(markersToRemove) ??
        markersToRemove.forEach((layer) => {
          markers.removeLayer(layer);
        });
    }
    if (markersToAdd.length) {
      markers.addLayers(markersToAdd);
    }

    const fetchDurationMs = Math.round(performance.now() - fetchStart);
    const markersAdded = markersToAdd.length;
    const markersRemoved = markersToRemove.length;
    const totalMarkers = markerIndex.size;

    if (!isUnmountedRef.current) {
      if (debugMetricsRef.current) {
        console.debug(
          `[LooMap] markers +${markersAdded}/-${markersRemoved} (total ${totalMarkers}); tiles ${tiles.length} (cache ${cacheHits}, fetch ${tilesToFetch.length}); ${fetchDurationMs}ms`,
        );
      }
      setLastMetrics({
        markersAdded,
        markersRemoved,
        totalMarkers,
        tilesRequested: tiles.length,
        cacheHits,
        fetchedTiles: tilesToFetch.length,
        fetchDurationMs,
      });
      setStatus({
        isLoading: false,
        error: null,
        looCount: totalMarkers,
        tileCount: tiles.length,
        precision,
      });
    }
  }, [apiUrl, updateDebugTiles]);

  useEffect(() => {
    debugMetricsRef.current = debugMetricsEnabled;
  }, [debugMetricsEnabled]);

  useEffect(() => {
    fetchViewportRef.current = () => {
      fetchViewportLoos().catch((error) => {
        console.error("Failed to refresh loos", error);
      });
    };
  }, [fetchViewportLoos]);

  useEffect(() => {
    if (!debugEnabled) {
      if (debugLayerRef.current) {
        debugLayerRef.current.remove();
        debugLayerRef.current = null;
      }
      return;
    }

    const map = mapRef.current;
    const leaflet = leafletRef.current;
    if (!map || !leaflet) return;

    if (!debugLayerRef.current) {
      debugLayerRef.current = leaflet.layerGroup().addTo(map);
    }

    updateDebugTiles(lastTilesRef.current);
  }, [debugEnabled, updateDebugTiles]);

  useEffect(() => {
    isUnmountedRef.current = false;
    let disposed = false;

    const bootstrap = async () => {
      if (!mapContainerRef.current) return;
      const leaflet = await loadLeaflet();
      if (!mapContainerRef.current || disposed) return;

      leafletRef.current = leaflet;

      const map = leaflet
        .map(mapContainerRef.current, {
          preferCanvas: true,
          zoomSnap: 0.5,
          zoomDelta: 0.5,
          worldCopyJump: true,
        })
        .setView(DEFAULT_CENTER, DEFAULT_ZOOM);

      leaflet
        .tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        })
        .addTo(map);

      const markerLayer = leaflet.markerClusterGroup({
        chunkedLoading: true,
        chunkDelay: 25,
        chunkInterval: 150,
        maxClusterRadius: getClusterRadius,
        disableClusteringAtZoom: 16,
        animate: false,
        animateAddingMarkers: false,
        spiderfyOnMaxZoom: false,
        showCoverageOnHover: false,
      });

      map.addLayer(markerLayer);
      mapRef.current = map;
      markersRef.current = markerLayer;

      map.on("moveend", scheduleFetch);
      map.on("zoomend", scheduleFetch);
      map.whenReady(scheduleFetch);
    };

    bootstrap().catch((error) => {
      console.error("Failed to initialise LooMap", error);
    });

    return () => {
      disposed = true;
      isUnmountedRef.current = true;
      abortControllerRef.current?.abort();
      if (fetchTimeoutRef.current) window.clearTimeout(fetchTimeoutRef.current);
      const map = mapRef.current;
      if (map) {
        map.off("moveend", scheduleFetch);
        map.off("zoomend", scheduleFetch);
        map.remove();
      }
      const markerLayer = markersRef.current;
      if (markerLayer) {
        markerIndexRef.current.forEach((marker) => {
          markerLayer.removeLayer(marker);
        });
      }
      markerIndexRef.current.clear();
      mapRef.current = null;
      markersRef.current = null;
      leafletRef.current = null;
      if (debugLayerRef.current) {
        debugLayerRef.current.remove();
        debugLayerRef.current = null;
      }
      lastTilesRef.current = [];
      tileCacheRef.current.clear();
    };
  }, [scheduleFetch]);

  useEffect(() => {
    tileCacheRef.current.clear();
    lastTilesRef.current = [];
    debugLayerRef.current?.clearLayers();
    markerIndexRef.current.forEach((marker) => {
      markersRef.current?.removeLayer(marker);
    });
    markerIndexRef.current.clear();
    setLastMetrics(null);
    if (mapRef.current) {
      scheduleFetch();
    }
  }, [apiUrl, scheduleFetch]);

  const statusMessage = status.error
    ? `Error loading loos: ${status.error}`
    : status.isLoading
      ? "Loading loos…"
      : `${status.looCount} loos · ${status.tileCount} tiles · /${status.precision}`;

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100vh",
        minHeight: "480px",
      }}
    >
      <div ref={mapContainerRef} style={{ width: "100%", height: "100%" }} />
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "1rem",
          transform: "translateX(-50%)",
          zIndex: 1000,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            background: "rgba(23, 32, 38, 0.9)",
            color: "white",
            padding: "0.5rem 1rem",
            borderRadius: "18px",
            fontSize: "0.85rem",
            boxShadow: "0 3px 12px rgba(0,0,0,0.35)",
            display: "flex",
            flexDirection: "column",
            gap: "0.45rem",
            pointerEvents: "auto",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "0.75rem",
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
              <span
                style={{
                  width: "0.45rem",
                  height: "0.45rem",
                  borderRadius: "999px",
                  backgroundColor: status.error
                    ? "#FF6B6B"
                    : status.isLoading
                      ? "#F4D35E"
                      : "#62C370",
                  display: "inline-block",
                }}
              />
              <span>{statusMessage}</span>
            </div>
            <div style={{ display: "flex", gap: "0.4rem" }}>
              <button
                type="button"
                onClick={toggleDebugLayer}
                style={{
                  border: "none",
                  borderRadius: "999px",
                  background: debugEnabled ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.08)",
                  color: "white",
                  fontSize: "0.75rem",
                  padding: "0.2rem 0.75rem",
                  cursor: "pointer",
                }}
              >
                {debugEnabled ? "Hide tiles" : "Show tiles"}
              </button>
              <button
                type="button"
                onClick={toggleDebugMetrics}
                style={{
                  border: "none",
                  borderRadius: "999px",
                  background: debugMetricsEnabled
                    ? "rgba(255,255,255,0.2)"
                    : "rgba(255,255,255,0.08)",
                  color: "white",
                  fontSize: "0.75rem",
                  padding: "0.2rem 0.75rem",
                  cursor: "pointer",
                }}
              >
                {debugMetricsEnabled ? "Hide stats" : "Show stats"}
              </button>
            </div>
          </div>
          {debugMetricsEnabled && lastMetrics ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
                gap: "0.35rem 0.85rem",
                fontSize: "0.75rem",
              }}
            >
              <div>
                <strong style={{ display: "block", fontWeight: 500 }}>Markers</strong>+
                {lastMetrics.markersAdded} / -{lastMetrics.markersRemoved}
              </div>
              <div>
                <strong style={{ display: "block", fontWeight: 500 }}>Total</strong>
                {lastMetrics.totalMarkers.toLocaleString()}
              </div>
              <div>
                <strong style={{ display: "block", fontWeight: 500 }}>Tiles</strong>
                {lastMetrics.tilesRequested} (cache {lastMetrics.cacheHits}, fetch{" "}
                {lastMetrics.fetchedTiles})
              </div>
              <div>
                <strong style={{ display: "block", fontWeight: 500 }}>Fetch</strong>
                {lastMetrics.fetchDurationMs} ms
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
