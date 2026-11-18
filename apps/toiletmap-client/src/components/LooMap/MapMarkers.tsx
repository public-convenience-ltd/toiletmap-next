import L from "leaflet";
import "leaflet.markercluster";
import ngeohash from "ngeohash";
import { useEffect, useRef } from "preact/hooks";
import { getLooById, type LooDetail, peekLooDetail } from "../../api/loos";
import type { ActiveFilters } from "../../types/filters";
import { filterLoos } from "./filterLoos";
import { makeIcon } from "./looIcon";
import type { CompressedLoo } from "./useMapData";

interface MapMarkersProps {
  map: L.Map | null;
  data: CompressedLoo[];
  activeFilters: ActiveFilters;
  apiUrl: string;
  selectedToiletId: string | null;
  onToiletSelect: (loo: LooDetail) => void;
  /**
   * Filled with a function that moves keyboard focus to a toilet's marker (or the cluster
   * it is folded into), returning false when it isn't drawn. LooMap uses it to put focus
   * back on the marker when the details panel closes.
   */
  focusMarkerRef?: { current: ((id: string) => boolean) | null };
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

// Shared with LooMap's empty state (a module of its own, so tests can stub MapMarkers).
export { filterLoos } from "./filterLoos";

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

/** Draws the selected marker above every other marker and cluster icon. */
const SELECTED_Z_OFFSET = 10_000;

export default function MapMarkers({
  map,
  data,
  activeFilters,
  apiUrl,
  selectedToiletId,
  onToiletSelect,
  focusMarkerRef,
}: MapMarkersProps) {
  const markerClusterGroup = useRef<L.MarkerClusterGroup | null>(null);
  const markersById = useRef<Map<string, L.Marker>>(new Map());
  // The rows currently drawn, keyed by id (input to diffMarkers).
  const shownById = useRef<Map<string, CompressedLoo>>(new Map());
  /**
   * The selected toilet's marker, taken out of the cluster group and drawn straight on the
   * map while it is selected, so it is never folded into a cluster (a deep link at street
   * zoom in a busy area would otherwise show only a "12") and sits above the cluster icons.
   * It is never in the group while detached.
   */
  const detachedRef = useRef<{ id: string; marker: L.Marker } | null>(null);
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
      if (detachedRef.current) map.removeLayer(detachedRef.current.marker);
      detachedRef.current = null;
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
    // The detached (selected) marker isn't in the group: take it off the map instead.
    const retire = (marker: L.Marker) => {
      if (detachedRef.current?.marker === marker) {
        map?.removeLayer(marker);
        detachedRef.current = null;
      } else {
        toRemove.push(marker);
      }
    };

    for (const id of diff.removed) {
      const marker = markers.get(id);
      if (marker) retire(marker);
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
      if (old) retire(old);
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

    // A new marker for the selected toilet is detached below, not clustered.
    const selectedId = selectedToiletIdRef.current;
    const clustered = (marker: L.Marker) => !selectedId || markers.get(selectedId) !== marker;

    if (toRemove.length > 0 && toRemove.length > shownBefore * FULL_REBUILD_RATIO) {
      group.clearLayers();
      group.addLayers(
        Array.from(markers.values()).filter(
          (m) => clustered(m) && m !== detachedRef.current?.marker,
        ),
      );
    } else {
      if (toRemove.length > 0) group.removeLayers(toRemove);
      const adding = toAdd.filter(clustered);
      if (adding.length > 0) group.addLayers(adding);
    }
    syncSelected();
  }, [map, data, activeFilters]);

  /**
   * Makes the drawn markers match the selection: the selected toilet's marker detached and
   * highlighted, every other marker plain and back in the cluster group.
   */
  const syncSelected = () => {
    const group = markerClusterGroup.current;
    if (!map || !group) return;
    const selectedId = selectedToiletIdRef.current;
    const wanted = selectedId ? (markersById.current.get(selectedId) ?? null) : null;
    const current = detachedRef.current;
    if (current && current.marker !== wanted) {
      map.removeLayer(current.marker);
      current.marker.setIcon(getIcon(false));
      current.marker.setZIndexOffset(0);
      // Only re-cluster it if it's still one of the drawn markers.
      if (markersById.current.get(current.id) === current.marker) group.addLayer(current.marker);
      detachedRef.current = null;
    }
    if (wanted && selectedId && detachedRef.current?.marker !== wanted) {
      if (group.hasLayer(wanted)) group.removeLayer(wanted);
      wanted.setIcon(getIcon(true));
      wanted.setZIndexOffset(SELECTED_Z_OFFSET);
      map.addLayer(wanted);
      detachedRef.current = { id: selectedId, marker: wanted };
    }
  };

  useEffect(() => {
    syncSelected();
  }, [map, selectedToiletId]);

  useEffect(() => {
    if (!focusMarkerRef) return;
    focusMarkerRef.current = (id: string) => {
      const marker = markersById.current.get(id);
      const group = markerClusterGroup.current;
      if (!marker) return false;
      const shown =
        detachedRef.current?.marker === marker ? marker : group?.getVisibleParent(marker);
      const element = (shown as L.Marker | null | undefined)?.getElement?.();
      if (!element?.isConnected) return false;
      element.focus({ preventScroll: true });
      return document.activeElement === element;
    };
    return () => {
      focusMarkerRef.current = null;
    };
  }, [focusMarkerRef]);

  return null;
}
