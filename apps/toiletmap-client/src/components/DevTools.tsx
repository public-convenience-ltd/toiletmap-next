import { del, entries, keys } from "idb-keyval";
import { useEffect, useState } from "preact/hooks";
import styles from "./DevTools.module.css";

interface DevToolsProps {
  isOpen: boolean;
  onClose: () => void;
  mapInstance?: L.Map | null;
}

interface CacheStats {
  count: number;
  sizeKb: number;
}

interface MapStats {
  zoom: number;
  center: [number, number];
  bounds: string;
}

const DevTools = ({ isOpen, onClose, mapInstance }: DevToolsProps) => {
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [mapStats, setMapStats] = useState<MapStats | null>(null);

  const loadCacheStats = async () => {
    const allEntries = await entries();
    const totalBytes = allEntries.reduce(
      (sum, [, value]) => sum + new Blob([JSON.stringify(value)]).size,
      0,
    );
    setCacheStats({ count: allEntries.length, sizeKb: Math.round(totalBytes / 1024) });
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

  useEffect(() => {
    if (isOpen) {
      loadCacheStats();
      loadMapStats();
    }
  }, [isOpen, mapInstance]);

  const clearAllCache = async () => {
    if (!confirm("Clear all cached data and reload the map?")) return;
    const allKeys = await keys();
    await Promise.all(allKeys.map((key) => del(key)));
    window.location.reload();
  };

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

        <div className={styles.content}>
          <section className={styles.section}>
            <h3>Cache</h3>
            {cacheStats ? (
              <div className={styles.stats}>
                <div className={styles.statItem}>
                  <strong>Entries:</strong> {cacheStats.count}
                </div>
                <div className={styles.statItem}>
                  <strong>Est. size:</strong> {cacheStats.sizeKb} KB
                </div>
              </div>
            ) : (
              <p className={styles.note}>Loading…</p>
            )}
            <div className={styles.actions}>
              <button type="button" className={styles.actionBtn} onClick={loadCacheStats}>
                <i className="fa-solid fa-refresh" /> Refresh
              </button>
              <button type="button" className={styles.dangerBtn} onClick={clearAllCache}>
                <i className="fa-solid fa-trash" /> Clear All
              </button>
            </div>
          </section>

          <section className={styles.section}>
            <h3>Map</h3>
            {mapStats ? (
              <div className={styles.stats}>
                <div className={styles.statItem}>
                  <strong>Zoom:</strong> {mapStats.zoom}
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
              <p className={styles.note}>Map not initialised</p>
            )}
            <div className={styles.actions}>
              <button type="button" className={styles.actionBtn} onClick={loadMapStats}>
                <i className="fa-solid fa-refresh" /> Refresh
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default DevTools;
