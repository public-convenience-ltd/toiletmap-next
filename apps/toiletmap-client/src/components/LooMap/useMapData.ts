import { get, set } from "idb-keyval";
import { useEffect, useState } from "preact/hooks";
import { getApiUrl } from "../../api/config";
import { CACHE_KEYS } from "../../api/constants";

export type CompressedLoo = [string, string, number]; // id, geohash, filterMask

export function useMapData(apiUrl: string) {
  const [data, setData] = useState<CompressedLoo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        let cachedData: CompressedLoo[] | undefined = await get(CACHE_KEYS.LOOS_LIST);
        const lastUpdated = await get(CACHE_KEYS.LAST_UPDATED);
        const now = new Date().toISOString();

        if (cachedData && lastUpdated) {
          console.log("Checking for updates since:", lastUpdated);
          const response = await fetch(getApiUrl(apiUrl, `/api/loos/updates?since=${lastUpdated}`));
          const updates = (await response.json()) as {
            upserted: CompressedLoo[];
            deleted: string[];
          };

          if (updates.upserted.length > 0 || updates.deleted.length > 0) {
            console.log(
              `Applying updates: ${updates.upserted.length} upserted, ${updates.deleted.length} deleted`,
            );
            const dataMap = new Map(cachedData.map((loo) => [loo[0], loo]));

            // Apply deletes
            updates.deleted.forEach((id) => {
              dataMap.delete(id);
            });

            // Apply upserts
            updates.upserted.forEach((loo) => {
              dataMap.set(loo[0], loo);
            });

            cachedData = Array.from(dataMap.values());
            await set(CACHE_KEYS.LOOS_LIST, cachedData);
            await set(CACHE_KEYS.LAST_UPDATED, now);
          } else {
            console.log("No updates found");
          }
        } else {
          console.log("Fetching fresh dump...");
          const response = await fetch(getApiUrl(apiUrl, "/api/loos/dump"));
          const json = (await response.json()) as { data: CompressedLoo[] };
          cachedData = json.data;
          await set(CACHE_KEYS.LOOS_LIST, cachedData);
          await set(CACHE_KEYS.LAST_UPDATED, now);
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
