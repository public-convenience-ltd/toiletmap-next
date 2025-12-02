import { get, set } from "idb-keyval";
import { useEffect, useState } from "preact/hooks";
import { getApiUrl } from "../../api/config";
import { CACHE_DURATION, CACHE_KEYS } from "../../api/constants";

export type CompressedLoo = [string, string, number]; // id, geohash, filterMask

export function useMapData(apiUrl: string) {
  const [data, setData] = useState<CompressedLoo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        let cachedData: CompressedLoo[] | undefined = await get(CACHE_KEYS.LOOS_LIST);
        const cacheTime = await get(CACHE_KEYS.LOOS_LIST_TIME);
        const now = Date.now();

        if (!cachedData || !cacheTime || now - cacheTime > CACHE_DURATION) {
          console.log("Fetching fresh data...");
          const response = await fetch(getApiUrl(apiUrl, "/api/loos/dump"));
          const json = (await response.json()) as { data: CompressedLoo[] };
          cachedData = json.data;
          await set(CACHE_KEYS.LOOS_LIST, cachedData);
          await set(CACHE_KEYS.LOOS_LIST_TIME, now);
        } else {
          console.log("Using cached data");
        }

        if (cachedData) {
          setData(cachedData);
        }
      } catch (error) {
        console.error("Failed to load map data:", error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [apiUrl]);

  return { data, loading };
}
