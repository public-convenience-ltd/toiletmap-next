import { get, set } from "idb-keyval";
import type * as L from "leaflet";
import type { LayerGroup, Map as LeafletMap, MarkerClusterGroup } from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import type {} from "leaflet.markercluster";
import ngeohash from "ngeohash";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type {
  ApiLooResponse,
  CacheTreeStats,
  FetchMetrics,
  LooMapProps,
  MapLoo,
  StatusState,
} from "./LooMap/types";
import type { CacheTree, CacheTreeSnapshot } from "./LooMap/cache-tree";
import {
  CACHE_TREE_STORAGE_KEY,
  computeCacheTreeStats,
  createCacheTree,
  fromSnapshot,
  getCachedTileData,
  replaceTileData,
  shouldHydrateTile,
  toSnapshot,
} from "./LooMap/cache-tree";
import {
  computeTilesForBounds,
  createToiletIcon,
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  FETCH_BATCH_SIZE,
  FETCH_DEBOUNCE_MS,
  HYDRATION_BATCH_SIZE,
  HYDRATION_LOW_DENSITY_THRESHOLD,
  HYDRATION_LOW_DENSITY_TILE_LIMIT,
  HYDRATION_MAX_TILES,
  HYDRATION_MIN_PRECISION,
  HYDRATION_MIN_ZOOM,
  describeFeatures,
  getClusterRadius,
  getDebugColor,
  getPrecisionForZoom,
  inflateTileData,
  mapFullLooResponse,
  loadLeaflet,
  parseCompressedResponse,
  VIEWPORT_PADDING,
} from "./LooMap/utils";

export default function LooMap({ apiUrl }: LooMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef<MarkerClusterGroup | null>(null);
  const leafletRef = useRef<typeof L | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const hydrationAbortControllerRef = useRef<AbortController | null>(null);
  const cacheTreeRef = useRef<CacheTree>(createCacheTree());
  const cacheHydratedRef = useRef(false);
  const cacheLoadPromiseRef = useRef<Promise<void> | null>(null);
  const fetchTimeoutRef = useRef<number | null>(null);
  const persistTimeoutRef = useRef<number | null>(null);
  const fetchViewportRef = useRef<() => void>();
  const isUnmountedRef = useRef(false);
  const debugLayerRef = useRef<LayerGroup | null>(null);
  const lastTilesRef = useRef<string[]>([]);
  const markerIndexRef = useRef<Map<string, L.Marker>>(new Map());
  const debugMetricsRef = useRef(false);
  const looDataRef = useRef<Map<string, MapLoo>>(new Map());
  const selectedLooRef = useRef<MapLoo | null>(null);
  const pendingLooHydrationsRef = useRef<Map<string, Promise<void>>>(new Map());

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
  const [cacheStats, setCacheStats] = useState<CacheTreeStats>(() =>
    computeCacheTreeStats(cacheTreeRef.current, Date.now()),
  );
  const [selectedLoo, setSelectedLoo] = useState<MapLoo | null>(null);
  const [drawerCollapsed, setDrawerCollapsed] = useState(false);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);

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

  const toggleDrawerCollapsed = useCallback(() => {
    setDrawerCollapsed((prev) => !prev);
  }, []);

  const closeDrawer = useCallback(() => {
    setSelectedLoo(null);
    setDrawerLoading(false);
    setDrawerError(null);
  }, []);

  const scheduleFetch = useCallback(() => {
    if (fetchTimeoutRef.current) {
      window.clearTimeout(fetchTimeoutRef.current);
    }
    fetchTimeoutRef.current = window.setTimeout(() => {
      fetchViewportRef.current?.();
    }, FETCH_DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadPromise = (async () => {
      try {
        const snapshot = await get<CacheTreeSnapshot>(CACHE_TREE_STORAGE_KEY);
        if (snapshot) {
          cacheTreeRef.current = fromSnapshot(snapshot);
          if (!cancelled) {
            setCacheStats(computeCacheTreeStats(cacheTreeRef.current, Date.now()));
          }
        }
      } catch (error) {
        console.warn("Failed to load cached tile tree", error);
      } finally {
        cacheHydratedRef.current = true;
        cacheLoadPromiseRef.current = null;
      }
    })();

    cacheLoadPromiseRef.current = loadPromise;
    loadPromise
      .then(() => {
        if (!cancelled && mapRef.current) {
          scheduleFetch();
        }
      })
      .catch(() => {
        // Already logged in the inner try/catch
      });

    return () => {
      cancelled = true;
      if (persistTimeoutRef.current) {
        window.clearTimeout(persistTimeoutRef.current);
        persistTimeoutRef.current = null;
      }
      hydrationAbortControllerRef.current?.abort();
    };
  }, [scheduleFetch]);

  const persistTree = useCallback(() => {
    if (persistTimeoutRef.current) return;
    persistTimeoutRef.current = window.setTimeout(() => {
      persistTimeoutRef.current = null;
      const snapshot = toSnapshot(cacheTreeRef.current);
      set(CACHE_TREE_STORAGE_KEY, snapshot).catch((error) => {
        console.warn("Failed to persist tile cache tree", error);
      });
    }, 300);
  }, []);

  const hydrateLooById = useCallback(
    (id: string): Promise<void> => {
      const existing = pendingLooHydrationsRef.current.get(id);
      if (existing) {
        return existing;
      }
      const promise = (async () => {
        try {
          setDrawerLoading(true);
          setDrawerError(null);
          const response = await fetch(`${apiUrl}/api/loos/${id}`);
          if (!response.ok) {
            throw new Error(`Failed to load loo ${id} (${response.status})`);
          }
          const payload = (await response.json()) as ApiLooResponse;
          const mapped = mapFullLooResponse(payload);
          looDataRef.current.set(mapped.id, mapped);
          setSelectedLoo((prev) => (prev && prev.id === mapped.id ? mapped : prev));
        } catch (error) {
          console.error("JIT hydration failed", error);
          setDrawerError((error as Error).message ?? "Failed to load details");
        } finally {
          setDrawerLoading(false);
          pendingLooHydrationsRef.current.delete(id);
        }
      })();
      pendingLooHydrationsRef.current.set(id, promise);
      return promise;
    },
    [apiUrl],
  );

  const handleMarkerSelect = useCallback(
    (id: string) => {
      const next = looDataRef.current.get(id);
      if (!next) return;
      setSelectedLoo(next);
      setDrawerCollapsed(false);
      setDrawerError(null);
      setDrawerLoading(next.detailLevel === "compressed");
      if (next.detailLevel === "compressed") {
        hydrateLooById(id);
      } else {
        setDrawerLoading(false);
      }
    },
    [hydrateLooById],
  );

  const hydrateTiles = useCallback(
    async (tiles: string[]) => {
      if (!tiles.length) return;
      hydrationAbortControllerRef.current?.abort();
      const controller = new AbortController();
      hydrationAbortControllerRef.current = controller;

      const now = Date.now();
      const actionable = tiles.filter((tile) => shouldHydrateTile(cacheTreeRef.current, tile, now));
      if (!actionable.length) {
        hydrationAbortControllerRef.current = null;
        return;
      }

      let treeUpdated = false;
      const hydratedLoos = new Map<string, MapLoo>();

      try {
        for (let i = 0; i < actionable.length; i += HYDRATION_BATCH_SIZE) {
          const batch = actionable.slice(i, i + HYDRATION_BATCH_SIZE);
          const responses = await Promise.all(
            batch.map(async (tile) => {
              try {
                const response = await fetch(`${apiUrl}/api/loos/geohash/${tile}?active=true`, {
                  signal: controller.signal,
                });
                if (!response.ok) {
                  throw new Error(`Failed to hydrate tile ${tile} (${response.status})`);
                }
                const payload = (await response.json()) as { data?: unknown };
                const rawData = Array.isArray(payload?.data) ? payload.data : [];
                const mapped = (rawData as ApiLooResponse[])
                  .map((record) => {
                    try {
                      return mapFullLooResponse(record);
                    } catch (error) {
                      console.warn(`Skipping malformed loo ${record.id}`, error);
                      return null;
                    }
                  })
                  .filter((entry): entry is MapLoo => entry !== null);
                mapped.forEach((entry) => {
                  hydratedLoos.set(entry.id, entry);
                });
                return { tile, data: mapped };
              } catch (error) {
                if ((error as DOMException).name === "AbortError") {
                  throw error;
                }
                console.warn(`Hydration request failed for tile ${tile}`, error);
                return null;
              }
            }),
          );
          const fetchedAt = Date.now();
          for (const result of responses) {
            if (!result) continue;
            replaceTileData(cacheTreeRef.current, result.tile, result.data, fetchedAt, "full");
            treeUpdated = true;
          }
        }
      } catch (error) {
        if ((error as DOMException).name !== "AbortError") {
          console.error("Error hydrating tiles", error);
        }
      } finally {
        if (hydrationAbortControllerRef.current === controller) {
          hydrationAbortControllerRef.current = null;
        }
      }

      if (hydratedLoos.size) {
        hydratedLoos.forEach((loo) => {
          looDataRef.current.set(loo.id, loo);
        });
        const selectedId = selectedLooRef.current?.id;
        if (selectedId) {
          const updated = hydratedLoos.get(selectedId);
          if (updated) {
            setSelectedLoo(updated);
            setDrawerLoading(false);
            setDrawerError(null);
          }
        }
      }

      if (treeUpdated) {
        persistTree();
        if (!isUnmountedRef.current) {
          setCacheStats(computeCacheTreeStats(cacheTreeRef.current, Date.now()));
        }
      }
    },
    [apiUrl, persistTree],
  );

  const fetchViewportLoos = useCallback(async () => {
    const map = mapRef.current;
    const markers = markersRef.current;
    const leaflet = leafletRef.current;
    if (!map || !markers || !leaflet) return;
    hydrationAbortControllerRef.current?.abort();

    if (!cacheHydratedRef.current && cacheLoadPromiseRef.current) {
      try {
        await cacheLoadPromiseRef.current;
      } catch {
        // Already logged during hydration
      }
    }

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
    const hydrationCandidates = new Set<string>();
    const sparseTileCandidates = new Set<string>();
    let cacheHits = 0;
    let treeUpdated = false;

    const markSparseIfNeeded = (tile: string, data: MapLoo[]) => {
      if (data.length <= HYDRATION_LOW_DENSITY_THRESHOLD) {
        sparseTileCandidates.add(tile);
      }
    };

    for (const tile of tiles) {
      const cached = getCachedTileData(cacheTreeRef.current, tile, now);
      if (cached) {
        tileData.set(tile, cached.data);
        markSparseIfNeeded(tile, cached.data);
        cacheHits += 1;
        if (cached.coverageKind !== "full" || cached.sourcePrefix !== tile) {
          hydrationCandidates.add(tile);
        }
      } else {
        tilesToFetch.push(tile);
      }
    }

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
          for (const { tile, data } of responses) {
            replaceTileData(cacheTreeRef.current, tile, data, fetchedAt, "compressed");
            tileData.set(tile, data);
            markSparseIfNeeded(tile, data);
            hydrationCandidates.add(tile);
            treeUpdated = true;
          }
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
    if (treeUpdated) {
      persistTree();
      if (!isUnmountedRef.current) {
        setCacheStats(computeCacheTreeStats(cacheTreeRef.current, Date.now()));
      }
    }

    const aggregated = new Map<string, MapLoo>();
    tileData.forEach((loos) => {
      loos.forEach((loo) => {
        aggregated.set(loo.id, loo);
        looDataRef.current.set(loo.id, loo);
      });
    });
    const activeSelectionId = selectedLooRef.current?.id;
    if (activeSelectionId) {
      const refreshed = aggregated.get(activeSelectionId);
      if (refreshed) {
        setSelectedLoo((prev) => (prev && prev.id === refreshed.id ? refreshed : prev));
      }
    }

    const markerIndex = markerIndexRef.current;
    const viewportBounds = map.getBounds().pad(VIEWPORT_PADDING);
    const nextVisibleIds = new Set<string>();
    const markersToAdd: L.Marker[] = [];
    const markersToRemove: L.Marker[] = [];

    aggregated.forEach((loo) => {
      if (!viewportBounds.contains([loo.lat, loo.lng])) return;
      nextVisibleIds.add(loo.id);

      if (markerIndex.has(loo.id)) return;

      const marker = leaflet.marker([loo.lat, loo.lng], {
        icon: createToiletIcon(leaflet, Boolean(loo.features.accessible)),
        title: `Loo ${loo.id}`,
        alt: `Loo ${loo.id}`,
        keyboard: true,
      });
      marker.on("click", () => handleMarkerSelect(loo.id));
      marker.on("keypress", (event: L.LeafletEvent & { originalEvent?: KeyboardEvent }) => {
        if ((event.originalEvent as KeyboardEvent | undefined)?.key === "Enter") {
          handleMarkerSelect(loo.id);
        }
      });

      markerIndex.set(loo.id, marker);
      markersToAdd.push(marker);
    });

    markerIndex.forEach((marker, id) => {
      if (nextVisibleIds.has(id)) return;
      markersToRemove.push(marker);
      markerIndex.delete(id);
    });

    if (markersToRemove.length) {
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

    const allowZoomHydration =
      map.getZoom() >= HYDRATION_MIN_ZOOM &&
      precision >= HYDRATION_MIN_PRECISION &&
      tiles.length <= HYDRATION_MAX_TILES;

    const allowSparseHydration =
      sparseTileCandidates.size > 0 &&
      sparseTileCandidates.size <= HYDRATION_LOW_DENSITY_TILE_LIMIT;

    if (
      (allowZoomHydration || allowSparseHydration) &&
      (hydrationCandidates.size || sparseTileCandidates.size)
    ) {
      const combined = new Set<string>(allowZoomHydration ? hydrationCandidates : []);
      if (allowSparseHydration) {
        sparseTileCandidates.forEach((tile) => {
          combined.add(tile);
        });
      }
      if (combined.size) {
        hydrateTiles(Array.from(combined));
      }
    }
  }, [apiUrl, handleMarkerSelect, hydrateTiles, persistTree, updateDebugTiles]);

  useEffect(() => {
    debugMetricsRef.current = debugMetricsEnabled;
  }, [debugMetricsEnabled]);

  useEffect(() => {
    selectedLooRef.current = selectedLoo;
  }, [selectedLoo]);

  useEffect(() => {
    if (!selectedLoo) {
      setDrawerCollapsed(false);
    }
  }, [selectedLoo]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (document.querySelector('link[data-loo-fa="true"]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css";
    link.crossOrigin = "anonymous";
    link.referrerPolicy = "no-referrer";
    link.dataset.looFa = "true";
    document.head.appendChild(link);
  }, []);

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
      hydrationAbortControllerRef.current?.abort();
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
      cacheTreeRef.current = createCacheTree();
    };
  }, [scheduleFetch]);

  useEffect(() => {
    hydrationAbortControllerRef.current?.abort();
    cacheTreeRef.current = createCacheTree();
    cacheHydratedRef.current = true;
    cacheLoadPromiseRef.current = null;
    setCacheStats(computeCacheTreeStats(cacheTreeRef.current, Date.now()));
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
    <section
      style={{
        position: "relative",
        width: "100%",
        height: "100vh",
        minHeight: "480px",
      }}
      aria-label="Toilet Map"
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
          {debugMetricsEnabled ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
                gap: "0.35rem 0.85rem",
                fontSize: "0.75rem",
              }}
            >
              {lastMetrics ? (
                <>
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
                </>
              ) : null}
              <div>
                <strong style={{ display: "block", fontWeight: 500 }}>Cache nodes</strong>
                {cacheStats.nodeCount.toLocaleString()} (depth {cacheStats.maxDepth})
              </div>
              <div>
                <strong style={{ display: "block", fontWeight: 500 }}>Fresh tiles</strong>
                {cacheStats.freshCoverageNodes}/{cacheStats.coverageNodes}
              </div>
              <div>
                <strong style={{ display: "block", fontWeight: 500 }}>Unique loos</strong>
                {cacheStats.uniqueLoos.toLocaleString()}
              </div>
              <div>
                <strong style={{ display: "block", fontWeight: 500 }}>Hydrated tiles</strong>
                {cacheStats.fullCoverageNodes}
              </div>
              <div>
                <strong style={{ display: "block", fontWeight: 500 }}>Hydrated loos</strong>
                {cacheStats.hydratedLoos.toLocaleString()}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      {selectedLoo ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            pointerEvents: "none",
            padding: "0 1rem 1rem",
            zIndex: 1100,
            display: "flex",
            justifyContent: "center",
          }}
        >
          <LooDetailsDrawer
            loo={selectedLoo}
            collapsed={drawerCollapsed}
            onCollapseToggle={toggleDrawerCollapsed}
            onClose={closeDrawer}
            loading={drawerLoading}
            error={drawerError}
          />
        </div>
      ) : null}
    </section>
  );
}

type LooDetailsDrawerProps = {
  loo: MapLoo;
  collapsed: boolean;
  onCollapseToggle: () => void;
  onClose: () => void;
  loading: boolean;
  error: string | null;
};

const featureIconMap: Array<{ key: keyof MapLoo["features"]; label: string; icon: string }> = [
  { key: "accessible", label: "Accessible", icon: "fa-solid fa-wheelchair" },
  { key: "noPayment", label: "Free", icon: "fa-solid fa-sterling-sign" },
  { key: "radar", label: "RADAR", icon: "fa-solid fa-key" },
  { key: "babyChange", label: "Baby change", icon: "fa-solid fa-baby" },
  { key: "allGender", label: "All gender", icon: "fa-solid fa-venus-mars" },
  { key: "automatic", label: "Automatic", icon: "fa-solid fa-robot" },
];

const formatDateLabel = (value: string | null | undefined) => {
  if (!value) return "Not verified";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
};

const LooDetailsDrawer = ({
  loo,
  collapsed,
  onCollapseToggle,
  onClose,
  loading,
  error,
}: LooDetailsDrawerProps) => {
  const summary = describeFeatures(loo.features) || "No feature data";
  const area = loo.full?.area?.[0];
  const areaLabel = area?.name ?? "Unassigned area";
  const areaType = area?.type ? ` (${area.type})` : "";
  const statusLabel =
    typeof loo.full?.active === "boolean"
      ? loo.full.active
        ? "Active"
        : "Inactive"
      : "Unknown status";
  const verifiedLabel = formatDateLabel(loo.full?.verifiedAt);
  const paymentLabel =
    loo.full?.paymentDetails ??
    (loo.features.noPayment ? "No payment required" : "Payment unknown");
  const drawerStatusBanner = loading
    ? {
        text: "Loading details…",
        color: "var(--color-primary-navy, #0a165e)",
        bg: "rgba(10,22,94,0.08)",
      }
    : error
      ? { text: error, color: "#fff", bg: "var(--color-accent-pink, #ed3d62)" }
      : null;
  const hydrationChip =
    loo.detailLevel === "full" ? (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.25rem",
          borderRadius: "999px",
          padding: "0.1rem 0.65rem",
          fontSize: "0.7rem",
          background: "var(--color-accent-turquoise, #92f9db)",
          color: "var(--color-primary-navy, #0a165e)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        <i className="fa-solid fa-droplet" aria-hidden="true" />
        Hydrated
      </span>
    ) : null;

  const infoItems = [
    { icon: "fa-solid fa-location-dot", label: "Area", value: `${areaLabel}${areaType}` },
    { icon: "fa-solid fa-hashtag", label: "Geohash", value: loo.geohash },
    {
      icon: "fa-solid fa-location-crosshairs",
      label: "Coordinates",
      value: `${loo.lat.toFixed(4)}, ${loo.lng.toFixed(4)}`,
    },
    { icon: "fa-solid fa-circle-check", label: "Verification", value: verifiedLabel },
    { icon: "fa-solid fa-circle-info", label: "Status", value: statusLabel },
    { icon: "fa-solid fa-sterling-sign", label: "Payment", value: paymentLabel },
  ].filter((item) => Boolean(item.value));

  return (
    <aside
      aria-live="polite"
      style={{
        pointerEvents: "auto",
        margin: "0 auto",
        width: "min(860px, 92vw)",
      }}
    >
      <div
        style={{
          background: "var(--color-base-white, #ffffff)",
          borderRadius: "20px 20px 12px 12px",
          boxShadow: "0 -12px 32px rgba(10, 22, 94, 0.25)",
          padding: collapsed ? "0.65rem 1rem" : "0.9rem 1.5rem",
          transition: "padding 0.2s ease",
          maxHeight: collapsed ? "4.5rem" : "32vh",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "0.75rem",
            flexWrap: "wrap",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              <h3
                style={{
                  margin: 0,
                  fontSize: "1.1rem",
                  color: "var(--color-primary-navy, #0a165e)",
                }}
              >
                {loo.full?.name ?? `Loo ${loo.id}`}
              </h3>
              {hydrationChip}
            </div>
            <div
              style={{
                marginTop: "0.25rem",
                fontSize: "0.85rem",
                color: "var(--color-neutral-grey, #5c6b7c)",
              }}
            >
              {summary || "Feature info unavailable"}
            </div>
            {drawerStatusBanner ? (
              <div
                style={{
                  marginTop: "0.35rem",
                  fontSize: "0.75rem",
                  borderRadius: "999px",
                  padding: "0.2rem 0.75rem",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.35rem",
                  background: drawerStatusBanner.bg,
                  color: drawerStatusBanner.color,
                }}
              >
                {loading ? (
                  <i className="fa-solid fa-circle-notch fa-spin" aria-hidden="true" />
                ) : (
                  <i className="fa-solid fa-circle-exclamation" aria-hidden="true" />
                )}
                {drawerStatusBanner.text}
              </div>
            ) : null}
          </div>
          <div style={{ display: "flex", gap: "0.35rem" }}>
            <button
              type="button"
              onClick={onCollapseToggle}
              aria-label={collapsed ? "Expand details" : "Collapse details"}
              style={{
                border: "none",
                background: "var(--color-light-grey, #f4f4f4)",
                borderRadius: "999px",
                width: "36px",
                height: "36px",
                cursor: "pointer",
                color: "var(--color-primary-navy, #0a165e)",
              }}
            >
              <i
                className={`fa-solid ${collapsed ? "fa-chevron-up" : "fa-chevron-down"}`}
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close loo details"
              style={{
                border: "none",
                background: "var(--color-accent-pink, #ed3d62)",
                borderRadius: "999px",
                width: "36px",
                height: "36px",
                cursor: "pointer",
                color: "#fff",
              }}
            >
              <i className="fa-solid fa-xmark" aria-hidden="true" />
            </button>
          </div>
        </div>
        {!collapsed ? (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: "0.65rem",
                marginTop: "0.85rem",
              }}
            >
              {infoItems.map((item) => (
                <div
                  key={item.label}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.2rem",
                    background: "var(--color-light-grey, #f4f4f4)",
                    borderRadius: "12px",
                    padding: "0.65rem 0.75rem",
                  }}
                >
                  <span
                    style={{
                      fontSize: "0.7rem",
                      color: "var(--color-neutral-grey, #5c6b7c)",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    <i
                      className={item.icon}
                      aria-hidden="true"
                      style={{ marginRight: "0.35rem" }}
                    />
                    {item.label}
                  </span>
                  <span style={{ fontSize: "0.9rem", color: "var(--color-primary-navy, #0a165e)" }}>
                    {item.value}
                  </span>
                </div>
              ))}
            </div>
            <div
              style={{
                marginTop: "1rem",
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                gap: "0.5rem",
              }}
            >
              {featureIconMap.map((feature) => {
                const isActive = Boolean(loo.features[feature.key]);
                return (
                  <span
                    key={feature.key}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.4rem",
                      padding: "0.5rem 0.65rem",
                      borderRadius: "999px",
                      fontSize: "0.8rem",
                      background: isActive ? "rgba(98, 195, 112, 0.15)" : "rgba(10, 22, 94, 0.08)",
                      color: isActive
                        ? "var(--color-primary-navy, #0a165e)"
                        : "rgba(10, 22, 94, 0.55)",
                    }}
                  >
                    <i className={feature.icon} aria-hidden="true" />
                    {feature.label}
                  </span>
                );
              })}
            </div>
            {loo.full?.notes ? (
              <p
                style={{
                  marginTop: "1rem",
                  fontSize: "0.85rem",
                  color: "var(--color-primary-navy, #0a165e)",
                  background: "var(--color-light-grey, #f4f4f4)",
                  borderRadius: "12px",
                  padding: "0.85rem",
                }}
              >
                {loo.full.notes}
              </p>
            ) : null}
          </>
        ) : (
          <div
            style={{
              marginTop: "0.35rem",
              fontSize: "0.8rem",
              color: "var(--color-neutral-grey, #5c6b7c)",
            }}
          >
            {summary || "Feature info unavailable"}
          </div>
        )}
      </div>
    </aside>
  );
};
