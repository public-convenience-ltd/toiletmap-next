import L from "leaflet";
import "leaflet.markercluster";
import ngeohash from "ngeohash";
import { useEffect, useRef } from "preact/hooks";
import { getLooById, type LooDetail, peekLooDetail } from "../../api/loos";
import { type ActiveFilters, FILTER_BIT, type FilterKey } from "../../types/filters";
import { makeIcon } from "./looIcon";
import type { CompressedLoo } from "./useMapData";

interface MapMarkersProps {
  map: L.Map | null;
  data: CompressedLoo[];
  activeFilters: ActiveFilters;
  apiUrl: string;
  selectedToiletId: string | null;
  onToiletSelect: (loo: LooDetail) => void;
}

export interface MarkerDiff {
  /** Rows whose id is not on the map yet. */
  added: CompressedLoo[];
  /** Ids on the map that are no longer in the data. */
  removed: string[];
  /** Rows whose id is on the map but whose geohash or filter mask changed. */
  updated: CompressedLoo[];
}

/**
 * Pure diff between the rows currently drawn (`prev`, keyed by id) and the
 * rows that should be drawn (`next`). Unchanged rows appear in no list. If an
 * id appears twice in `next` the last row wins.
 */
export function diffMarkers(
  prev: ReadonlyMap<string, CompressedLoo>,
  next: readonly CompressedLoo[],
): MarkerDiff {
  const nextById = new Map<string, CompressedLoo>();
  for (const row of next) nextById.set(row[0], row);

  const added: CompressedLoo[] = [];
  const updated: CompressedLoo[] = [];
  for (const [id, row] of nextById) {
    const old = prev.get(id);
    if (!old) added.push(row);
    else if (old[1] !== row[1] || old[2] !== row[2]) updated.push(row);
  }
  const removed: string[] = [];
  for (const id of prev.keys()) {
    if (!nextById.has(id)) removed.push(id);
  }
  return { added, removed, updated };
}

/** Rows that pass the active filters (every selected feature bit must be set). */
export function filterLoos(data: CompressedLoo[], activeFilters: ActiveFilters): CompressedLoo[] {
  const requiredMask = (Object.keys(FILTER_BIT) as FilterKey[]).reduce(
    (acc, key) => (activeFilters[key] ? acc | FILTER_BIT[key] : acc),
    0,
  );
  return requiredMask === 0 ? data : data.filter((loo) => (loo[2] & requiredMask) === requiredMask);
}

// Shared icon instances: ~14k markers don't need ~14k identical icon objects.
let icons: { normal: L.DivIcon; highlighted: L.DivIcon } | null = null;
const getIcon = (isHighlighted: boolean) => {
  icons ??= { normal: makeIcon("default"), highlighted: makeIcon("highlighted") };
  return isHighlighted ? icons.highlighted : icons.normal;
};

/**
 * When an update would remove more than this share of the drawn markers (e.g.
 * a filter was switched on) it is cheaper to clear the cluster group and
 * re-add the survivors in one batch than to remove markers one by one.
 */
const FULL_REBUILD_RATIO = 0.5;

export default function MapMarkers({
  map,
  data,
  activeFilters,
  apiUrl,
  selectedToiletId,
  onToiletSelect,
}: MapMarkersProps) {
  const markerClusterGroup = useRef<L.MarkerClusterGroup | null>(null);
  const markersById = useRef<Map<string, L.Marker>>(new Map());
  // The rows currently drawn, keyed by id (input to diffMarkers).
  const shownById = useRef<Map<string, CompressedLoo>>(new Map());
  const prevSelectedIdRef = useRef<string | null>(null);
  const lastClickedIdRef = useRef<string | null>(null);
  // Refs keep marker click handlers stable so markers never need recreating
  // just because the parent re-rendered with a new callback or apiUrl.
  const onToiletSelectRef = useRef(onToiletSelect);
  onToiletSelectRef.current = onToiletSelect;
  const selectedToiletIdRef = useRef(selectedToiletId);
  selectedToiletIdRef.current = selectedToiletId;
  const apiUrlRef = useRef(apiUrl);
  apiUrlRef.current = apiUrl;

  useEffect(() => {
    if (!map) return;

    // Initialize MarkerClusterGroup
    const group = L.markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 80, // More aggressive clustering
      animate: false,
      animateAddingMarkers: false,
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
    markerClusterGroup.current = group;
    markersById.current = new Map();
    shownById.current = new Map();

    map.addLayer(group);

    return () => {
      map.removeLayer(group);
      if (markerClusterGroup.current === group) markerClusterGroup.current = null;
      markersById.current = new Map();
      shownById.current = new Map();
    };
  }, [map]);

  useEffect(() => {
    const group = markerClusterGroup.current;
    if (!group) return;

    // Stale-while-revalidate: show the cached detail at once, then replace it
    // if the server has a newer version (a 304 returns the same object).
    const handleClick = async (id: string) => {
      lastClickedIdRef.current = id;
      const cached = peekLooDetail(id);
      if (cached) onToiletSelectRef.current(cached);
      const fresh = await getLooById(apiUrlRef.current, id);
      if (!fresh || fresh === cached || lastClickedIdRef.current !== id) return;
      // Don't reopen a panel the user closed while we were revalidating.
      if (cached && selectedToiletIdRef.current !== id) return;
      onToiletSelectRef.current(fresh);
    };

    const createMarker = (loo: CompressedLoo) => {
      const { latitude, longitude } = ngeohash.decode(loo[1]);
      const id = loo[0];
      const marker = L.marker([latitude, longitude], {
        icon: getIcon(id === selectedToiletIdRef.current),
      });
      marker.on("click", () => {
        handleClick(id).catch((error) => console.error("Marker click failed:", error));
      });
      return marker;
    };

    const next = filterLoos(data, activeFilters);
    const shown = shownById.current;
    const markers = markersById.current;
    const shownBefore = shown.size;
    const diff = diffMarkers(shown, next);

    const toRemove: L.Marker[] = [];
    const toAdd: L.Marker[] = [];

    for (const id of diff.removed) {
      const marker = markers.get(id);
      if (marker) toRemove.push(marker);
      markers.delete(id);
      shown.delete(id);
    }
    for (const loo of diff.updated) {
      const id = loo[0];
      const previous = shown.get(id);
      shown.set(id, loo);
      // A filter-mask-only change doesn't alter how the marker looks.
      if (previous && previous[1] === loo[1] && markers.has(id)) continue;
      const old = markers.get(id);
      if (old) toRemove.push(old);
      const marker = createMarker(loo);
      markers.set(id, marker);
      toAdd.push(marker);
    }
    for (const loo of diff.added) {
      const marker = createMarker(loo);
      markers.set(loo[0], marker);
      shown.set(loo[0], loo);
      toAdd.push(marker);
    }

    if (toRemove.length > 0 && toRemove.length > shownBefore * FULL_REBUILD_RATIO) {
      group.clearLayers();
      group.addLayers(Array.from(markers.values()));
    } else {
      if (toRemove.length > 0) group.removeLayers(toRemove);
      if (toAdd.length > 0) group.addLayers(toAdd);
    }
  }, [map, data, activeFilters]);

  useEffect(() => {
    if (prevSelectedIdRef.current && prevSelectedIdRef.current !== selectedToiletId) {
      markersById.current.get(prevSelectedIdRef.current)?.setIcon(getIcon(false));
    }
    if (selectedToiletId) {
      markersById.current.get(selectedToiletId)?.setIcon(getIcon(true));
    }
    prevSelectedIdRef.current = selectedToiletId;
  }, [selectedToiletId]);

  return null;
}
