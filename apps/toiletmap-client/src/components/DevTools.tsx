import { del, entries, keys } from "idb-keyval";
import { useEffect, useState } from "preact/hooks";
import { CACHE_KEYS } from "../api/constants";
import styles from "./DevTools.module.css";

interface DevToolsProps {
  isOpen: boolean;
  onClose: () => void;
  mapInstance?: L.Map | null;
}

interface CacheEntry {
  key: string;
  size: string;
  sizeBytes: number;
  type: string;
  timestamp: string | null;
  value: unknown;
}

interface NetworkRequest {
  url: string;
  method: string;
  timestamp: number;
  status?: number;
  duration?: number;
}

type SortField = "key" | "type" | "size" | "timestamp";
type SortDirection = "asc" | "desc";

const DevTools = ({ isOpen, onClose, mapInstance }: DevToolsProps) => {
  const [activeTab, setActiveTab] = useState<"cache" | "network" | "storage" | "map">("cache");
  const [cacheEntries, setCacheEntries] = useState<CacheEntry[]>([]);
  const [filteredEntries, setFilteredEntries] = useState<CacheEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("timestamp");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(20);
  const [selectedEntry, setSelectedEntry] = useState<CacheEntry | null>(null);
  const [networkRequests] = useState<NetworkRequest[]>([]);
  const [storageQuota, setStorageQuota] = useState<{ usage: number; quota: number } | null>(null);
  const [mapStats, setMapStats] = useState<{
    zoom: number;
    center: [number, number];
    bounds: string;
  } | null>(null);
  const [richDumpInfo, setRichDumpInfo] = useState<{
    downloaded: boolean;
    timestamp: string | null;
  } | null>(null);

  useEffect(() => {
    if (isOpen) {
      if (activeTab === "cache") {
        loadCacheData();
      } else if (activeTab === "storage") {
        loadStorageQuota();
      } else if (activeTab === "map" && mapInstance) {
        loadMapStats();
      }
    }
  }, [isOpen, activeTab, mapInstance]);

  // Filter and sort entries when search, sort, or entries change
  useEffect(() => {
    let filtered = [...cacheEntries];

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (entry) =>
          entry.key.toLowerCase().includes(query) || entry.type.toLowerCase().includes(query),
      );
    }

    // Apply sorting
    filtered.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case "key":
          comparison = a.key.localeCompare(b.key);
          break;
        case "type":
          comparison = a.type.localeCompare(b.type);
          break;
        case "size":
          comparison = a.sizeBytes - b.sizeBytes;
          break;
        case "timestamp":
          if (!a.timestamp && !b.timestamp) comparison = 0;
          else if (!a.timestamp) comparison = 1;
          else if (!b.timestamp) comparison = -1;
          else comparison = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
          break;
      }
      return sortDirection === "asc" ? comparison : -comparison;
    });

    setFilteredEntries(filtered);
    setCurrentPage(1); // Reset to first page when filtering/sorting
  }, [cacheEntries, searchQuery, sortField, sortDirection]);

  const loadCacheData = async () => {
    try {
      const allEntries = await entries();
      const cacheData: CacheEntry[] = [];

      for (const [key, value] of allEntries) {
        const keyStr = String(key);
        let type = "Unknown";
        let timestamp: string | null = null;
        let actualValue = value;

        // Extract metadata if wrapped
        if (
          typeof value === "object" &&
          value !== null &&
          "data" in value &&
          "cachedAt" in value &&
          "version" in value
        ) {
          const wrapped = value as { data: unknown; cachedAt: string; version: number };
          timestamp = wrapped.cachedAt;
          actualValue = wrapped.data;
        }

        if (keyStr.startsWith("loo:")) {
          type = "Loo Detail";
        } else if (keyStr === CACHE_KEYS.LOOS_LIST) {
          type = "Loos List";
        } else if (keyStr === CACHE_KEYS.RICH_DUMP_DOWNLOADED) {
          type = "Rich Dump Flag";
        } else if (keyStr === CACHE_KEYS.RICH_DUMP_TIMESTAMP) {
          type = "Rich Dump Time";
        } else if (keyStr === CACHE_KEYS.LAST_UPDATED) {
          type = "Last Updated";
        }

        const sizeEstimate = JSON.stringify(value).length;
        cacheData.push({
          key: keyStr,
          size:
            sizeEstimate > 1024 ? `${(sizeEstimate / 1024).toFixed(2)} KB` : `${sizeEstimate} B`,
          sizeBytes: sizeEstimate,
          type,
          timestamp,
          value: actualValue,
        });
      }

      setCacheEntries(cacheData);

      // Load rich dump info
      const downloaded = allEntries.find(
        ([k]) => String(k) === CACHE_KEYS.RICH_DUMP_DOWNLOADED,
      )?.[1] as boolean | undefined;
      const timestamp = allEntries.find(
        ([k]) => String(k) === CACHE_KEYS.RICH_DUMP_TIMESTAMP,
      )?.[1] as string | undefined;
      setRichDumpInfo({
        downloaded: !!downloaded,
        timestamp: timestamp || null,
      });
    } catch (err) {
      console.error("Failed to load cache data", err);
    }
  };

  const loadStorageQuota = async () => {
    if (navigator.storage?.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        setStorageQuota({
          usage: estimate.usage || 0,
          quota: estimate.quota || 0,
        });
      } catch (err) {
        console.error("Failed to get storage quota", err);
      }
    }
  };

  const loadMapStats = () => {
    if (!mapInstance) return;

    const zoom = mapInstance.getZoom();
    const center = mapInstance.getCenter();
    const bounds = mapInstance.getBounds();

    setMapStats({
      zoom,
      center: [center.lat, center.lng],
      bounds: `NE: ${bounds.getNorthEast().lat.toFixed(4)}, ${bounds.getNorthEast().lng.toFixed(4)} | SW: ${bounds.getSouthWest().lat.toFixed(4)}, ${bounds.getSouthWest().lng.toFixed(4)}`,
    });
  };

  const clearAllCache = async () => {
    if (!confirm("Are you sure you want to clear all cached data?")) return;

    try {
      const allKeys = await keys();
      await Promise.all(allKeys.map((key) => del(key)));
      await loadCacheData();
      alert("Cache cleared successfully!");
    } catch (err) {
      console.error("Failed to clear cache", err);
      alert("Failed to clear cache");
    }
  };

  const clearSpecificKey = async (key: string) => {
    if (!confirm(`Clear cache key: ${key}?`)) return;

    try {
      await del(key);
      await loadCacheData();
    } catch (err) {
      console.error("Failed to clear key", err);
    }
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection(field === "timestamp" ? "desc" : "asc");
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / k ** i).toFixed(2)} ${sizes[i]}`;
  };

  const formatTimestamp = (timestamp: string | null) => {
    if (!timestamp) return "N/A";
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  // Pagination
  const totalPages = Math.ceil(filteredEntries.length / pageSize);
  const paginatedEntries = filteredEntries.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  if (!isOpen) return null;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Overlay click closes panel
    // biome-ignore lint/a11y/noStaticElementInteractions: Modal overlay click interaction
    <div className={styles.overlay} onClick={onClose}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: Stop propagation */}
      <div className={styles.panel} onClick={(e) => e.stopPropagation()} role="dialog">
        <div className={styles.header}>
          <h2>
            <i className="fa-solid fa-code" /> Developer Tools
          </h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
        <div className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tab} ${activeTab === "cache" ? styles.active : ""}`}
            onClick={() => setActiveTab("cache")}
          >
            <i className="fa-solid fa-database" /> Cache
          </button>
          <button
            type="button"
            className={`${styles.tab} ${activeTab === "network" ? styles.active : ""}`}
            onClick={() => setActiveTab("network")}
          >
            <i className="fa-solid fa-network-wired" /> Network
          </button>
          <button
            type="button"
            className={`${styles.tab} ${activeTab === "storage" ? styles.active : ""}`}
            onClick={() => setActiveTab("storage")}
          >
            <i className="fa-solid fa-hard-drive" /> Storage
          </button>
          <button
            type="button"
            className={`${styles.tab} ${activeTab === "map" ? styles.active : ""}`}
            onClick={() => setActiveTab("map")}
          >
            <i className="fa-solid fa-map-marked-alt" /> Map
          </button>
        </div>
        <div className={styles.content}>
          {activeTab === "cache" && (
            <div className={styles.tabContent}>
              <h3>Cache Management</h3>

              {richDumpInfo && (
                <div className={styles.infoBox}>
                  <strong>Rich Dump Status:</strong>{" "}
                  {richDumpInfo.downloaded ? (
                    <span className={styles.success}>
                      ✓ Downloaded{" "}
                      {richDumpInfo.timestamp &&
                        `on ${new Date(richDumpInfo.timestamp).toLocaleString()}`}
                    </span>
                  ) : (
                    <span className={styles.warning}>Not downloaded</span>
                  )}
                </div>
              )}

              <div className={styles.stats}>
                <div className={styles.statItem}>
                  <strong>Total Entries:</strong> {cacheEntries.length}
                </div>
                <div className={styles.statItem}>
                  <strong>Loo Details:</strong>{" "}
                  {cacheEntries.filter((e) => e.type === "Loo Detail").length}
                </div>
                <div className={styles.statItem}>
                  <strong>Filtered:</strong> {filteredEntries.length}
                </div>
              </div>

              <div className={styles.searchContainer}>
                <i className="fa-solid fa-search" />
                <input
                  type="text"
                  className={styles.searchInput}
                  placeholder="Search by key or type..."
                  value={searchQuery}
                  onInput={(e) => setSearchQuery(e.currentTarget.value)}
                />
                {searchQuery && (
                  <button
                    type="button"
                    className={styles.clearSearch}
                    onClick={() => setSearchQuery("")}
                    aria-label="Clear search"
                  >
                    <i className="fa-solid fa-times" />
                  </button>
                )}
              </div>

              <div className={styles.actions}>
                <button type="button" className={styles.actionBtn} onClick={loadCacheData}>
                  <i className="fa-solid fa-refresh" /> Refresh
                </button>
                <button type="button" className={styles.dangerBtn} onClick={clearAllCache}>
                  <i className="fa-solid fa-trash" /> Clear All Cache
                </button>
              </div>

              <div className={styles.tableContainer}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.sortable} onClick={() => handleSort("key")}>
                        Key{" "}
                        {sortField === "key" && (
                          <i className={`fa-solid fa-${sortDirection === "asc" ? "up" : "down"}`} />
                        )}
                      </th>
                      <th className={styles.sortable} onClick={() => handleSort("type")}>
                        Type{" "}
                        {sortField === "type" && (
                          <i className={`fa-solid fa-${sortDirection === "asc" ? "up" : "down"}`} />
                        )}
                      </th>
                      <th className={styles.sortable} onClick={() => handleSort("size")}>
                        Size{" "}
                        {sortField === "size" && (
                          <i className={`fa-solid fa-${sortDirection === "asc" ? "up" : "down"}`} />
                        )}
                      </th>
                      <th className={styles.sortable} onClick={() => handleSort("timestamp")}>
                        Cached At{" "}
                        {sortField === "timestamp" && (
                          <i className={`fa-solid fa-${sortDirection === "asc" ? "up" : "down"}`} />
                        )}
                      </th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedEntries.map((entry) => (
                      <tr key={entry.key}>
                        <td className={styles.keyCell}>{entry.key}</td>
                        <td>{entry.type}</td>
                        <td>{entry.size}</td>
                        <td>{formatTimestamp(entry.timestamp)}</td>
                        <td>
                          <button
                            type="button"
                            className={styles.smallBtn}
                            onClick={() => setSelectedEntry(entry)}
                            title="View Details"
                          >
                            <i className="fa-solid fa-eye" />
                          </button>
                          <button
                            type="button"
                            className={styles.smallBtn}
                            onClick={() => clearSpecificKey(entry.key)}
                            title="Delete"
                          >
                            <i className="fa-solid fa-trash" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredEntries.length === 0 && (
                  <div className={styles.emptyState}>
                    <i className="fa-solid fa-circle-info" />
                    <p>No cache entries found</p>
                  </div>
                )}
              </div>

              {totalPages > 1 && (
                <div className={styles.pagination}>
                  <button
                    type="button"
                    className={styles.pageBtn}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                  >
                    <i className="fa-solid fa-chevron-left" /> Previous
                  </button>
                  <span className={styles.pageInfo}>
                    Page {currentPage} of {totalPages}
                  </span>
                  <button
                    type="button"
                    className={styles.pageBtn}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                  >
                    Next <i className="fa-solid fa-chevron-right" />
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === "network" && (
            <div className={styles.tabContent}>
              <h3>Network Activity</h3>
              <p className={styles.note}>
                Network monitoring is not yet implemented. Use browser DevTools Network tab for now.
              </p>
              {networkRequests.length === 0 && (
                <div className={styles.emptyState}>
                  <i className="fa-solid fa-circle-info" />
                  <p>No network requests tracked</p>
                </div>
              )}
            </div>
          )}

          {activeTab === "storage" && (
            <div className={styles.tabContent}>
              <h3>Storage Information</h3>
              {storageQuota ? (
                <div>
                  <div className={styles.statItem}>
                    <strong>Storage Used:</strong> {formatBytes(storageQuota.usage)}
                  </div>
                  <div className={styles.statItem}>
                    <strong>Storage Quota:</strong> {formatBytes(storageQuota.quota)}
                  </div>
                  <div className={styles.statItem}>
                    <strong>Usage:</strong>{" "}
                    {((storageQuota.usage / storageQuota.quota) * 100).toFixed(2)}%
                  </div>
                  <div className={styles.progressBar}>
                    <div
                      className={styles.progressFill}
                      style={{ width: `${(storageQuota.usage / storageQuota.quota) * 100}%` }}
                    />
                  </div>
                </div>
              ) : (
                <p className={styles.note}>Storage quota information not available</p>
              )}
              <button type="button" className={styles.actionBtn} onClick={loadStorageQuota}>
                <i className="fa-solid fa-refresh" /> Refresh
              </button>
            </div>
          )}

          {activeTab === "map" && (
            <div className={styles.tabContent}>
              <h3>Map Statistics</h3>
              {mapStats ? (
                <div>
                  <div className={styles.statItem}>
                    <strong>Zoom Level:</strong> {mapStats.zoom}
                  </div>
                  <div className={styles.statItem}>
                    <strong>Center:</strong> [{mapStats.center[0].toFixed(6)},{" "}
                    {mapStats.center[1].toFixed(6)}]
                  </div>
                  <div className={styles.statItem}>
                    <strong>Bounds:</strong> {mapStats.bounds}
                  </div>
                </div>
              ) : (
                <p className={styles.note}>Map not initialized</p>
              )}
              <button type="button" className={styles.actionBtn} onClick={loadMapStats}>
                <i className="fa-solid fa-refresh" /> Refresh
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Detail Modal */}
      {selectedEntry && (
        // biome-ignore lint/a11y/useKeyWithClickEvents: Modal close
        // biome-ignore lint/a11y/noStaticElementInteractions: Modal overlay click dismiss
        <div className={styles.modalOverlay} onClick={() => setSelectedEntry(null)}>
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: Stop propagation */}
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()} role="dialog">
            <div className={styles.modalHeader}>
              <h3>Cache Entry Details</h3>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={() => setSelectedEntry(null)}
                aria-label="Close"
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.detailRow}>
                <strong>Key:</strong> <code>{selectedEntry.key}</code>
              </div>
              <div className={styles.detailRow}>
                <strong>Type:</strong> {selectedEntry.type}
              </div>
              <div className={styles.detailRow}>
                <strong>Size:</strong> {selectedEntry.size}
              </div>
              <div className={styles.detailRow}>
                <strong>Cached At:</strong> {formatTimestamp(selectedEntry.timestamp)}
              </div>
              {selectedEntry.type === "Loo Detail" && selectedEntry.value && (
                <div className={styles.looDetails}>
                  <h4>Loo Information</h4>
                  <pre className={styles.codeBlock}>
                    {JSON.stringify(selectedEntry.value, null, 2)}
                  </pre>
                </div>
              )}
              {selectedEntry.type !== "Loo Detail" && (
                <div className={styles.rawData}>
                  <h4>Raw Data</h4>
                  <pre className={styles.codeBlock}>
                    {JSON.stringify(selectedEntry.value, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DevTools;
