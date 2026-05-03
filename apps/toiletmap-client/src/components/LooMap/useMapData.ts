import { get, set } from "idb-keyval";
import { useEffect, useRef, useState } from "preact/hooks";
import { getApiUrl } from "../../api/config";
import { CACHE_KEYS } from "../../api/constants";

export type CompressedLoo = [string, string, number]; // id, geohash, filterMask

const POLL_INTERVAL_MS = 60_000; // re-fetch delta every 60 seconds
// After a full dump, set LAST_UPDATED this far in the past so the next delta
// re-covers recent mutations — guards against serving a stale cached dump.
const DUMP_OVERLAP_MS = 5 * 60 * 1000; // 5 minutes

export function useMapData(apiUrl: string) {
  const [data, setData] = useState<CompressedLoo[]>([]);
  const [loading, setLoading] = useState(true);
  // Stable ref to current data so the poll callback doesn't capture stale closure
  const dataRef = useRef<CompressedLoo[]>([]);

  useEffect(() => {
    let cancelled = false;

    const applyDelta = async (
      since: string,
      current: CompressedLoo[],
    ): Promise<{ next: CompressedLoo[]; updated: boolean }> => {
      const response = await fetch(getApiUrl(apiUrl, `/api/loos/updates?since=${since}`));
      const updates = (await response.json()) as {
        upserted: CompressedLoo[];
        deleted: string[];
      };

      if (updates.upserted.length === 0 && updates.deleted.length === 0) {
        return { next: current, updated: false };
      }

      const dataMap = new Map(current.map((loo) => [loo[0], loo]));
      for (const id of updates.deleted) dataMap.delete(id);
      for (const loo of updates.upserted) dataMap.set(loo[0], loo);

      console.log(
        `Applied delta: +${updates.upserted.length} upserted, -${updates.deleted.length} deleted`,
      );
      return { next: Array.from(dataMap.values()), updated: true };
    };

    const loadData = async () => {
      try {
        let cachedData: CompressedLoo[] | undefined = await get(CACHE_KEYS.LOOS_LIST);
        const lastUpdated: string | undefined = await get(CACHE_KEYS.LAST_UPDATED);
        const now = new Date().toISOString();

        if (cachedData && lastUpdated) {
          const { next, updated } = await applyDelta(lastUpdated, cachedData);
          if (updated) {
            cachedData = next;
            await set(CACHE_KEYS.LOOS_LIST, cachedData);
            await set(CACHE_KEYS.LAST_UPDATED, now);
          }
        } else {
          console.log("Fetching fresh dump…");
          const response = await fetch(getApiUrl(apiUrl, "/api/loos/dump"));
          const json = (await response.json()) as { data: CompressedLoo[] };
          cachedData = json.data;
          await set(CACHE_KEYS.LOOS_LIST, cachedData);
          // Use a timestamp slightly in the past so the next delta re-covers any
          // mutations that happened while the dump was cached on the server.
          const dumpSince = new Date(Date.now() - DUMP_OVERLAP_MS).toISOString();
          await set(CACHE_KEYS.LAST_UPDATED, dumpSince);
        }

        if (!cancelled && cachedData) {
          dataRef.current = cachedData;
          setData(cachedData);
        }
      } catch (error) {
        console.error("Failed to load map data:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    // Poll for updates so the map reflects changes made in the current session
    // without requiring a full page reload.
    const pollForUpdates = async () => {
      try {
        const lastUpdated: string | undefined = await get(CACHE_KEYS.LAST_UPDATED);
        if (!lastUpdated || dataRef.current.length === 0) return;

        const now = new Date().toISOString();
        const { next, updated } = await applyDelta(lastUpdated, dataRef.current);
        if (updated && !cancelled) {
          await set(CACHE_KEYS.LOOS_LIST, next);
          await set(CACHE_KEYS.LAST_UPDATED, now);
          dataRef.current = next;
          setData(next);
        }
      } catch (error) {
        console.error("Poll for updates failed:", error);
      }
    };

    loadData();

    const pollTimer = setInterval(pollForUpdates, POLL_INTERVAL_MS);

    // Also re-fetch when the user returns to this tab
    const handleVisibility = () => {
      if (document.visibilityState === "visible") pollForUpdates();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      clearInterval(pollTimer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [apiUrl]);

  return { data, loading };
}
