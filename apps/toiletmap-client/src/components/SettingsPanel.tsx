import { get } from "idb-keyval";
import { useEffect, useState } from "preact/hooks";
import { CACHE_KEYS } from "../api/constants";
import styles from "./SettingsPanel.module.css";

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onDownloadOffline: () => void;
  isDownloading: boolean;
  downloadProgress: string;
  onOpenDevTools: () => void;
}

const SettingsPanel = ({
  isOpen,
  onClose,
  onDownloadOffline,
  isDownloading,
  downloadProgress,
  onOpenDevTools,
}: SettingsPanelProps) => {
  const [richDumpDownloaded, setRichDumpDownloaded] = useState(false);
  const [richDumpTimestamp, setRichDumpTimestamp] = useState<string | null>(null);

  useEffect(() => {
    // Check if rich dump has been downloaded
    const checkRichDumpStatus = async () => {
      const downloaded = await get<boolean>(CACHE_KEYS.RICH_DUMP_DOWNLOADED);
      const timestamp = await get<string>(CACHE_KEYS.RICH_DUMP_TIMESTAMP);
      setRichDumpDownloaded(!!downloaded);
      setRichDumpTimestamp(timestamp || null);
    };

    if (isOpen) {
      checkRichDumpStatus();
    }
  }, [isOpen]);

  // Update rich dump status when download completes
  useEffect(() => {
    if (downloadProgress === "Done!") {
      setRichDumpDownloaded(true);
      setRichDumpTimestamp(new Date().toISOString());
    }
  }, [downloadProgress]);

  const isToggleOn = isDownloading || richDumpDownloaded;

  if (!isOpen) return null;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Overlay click closes panel
    // biome-ignore lint/a11y/noStaticElementInteractions: Modal overlay click interaction
    <div className={styles.overlay} onClick={onClose}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: Stop propagation */}
      <div className={styles.panel} onClick={(e) => e.stopPropagation()} role="dialog">
        <div className={styles.header}>
          <h2>Settings</h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
        <div className={styles.content}>
          <div className={styles.section}>
            <h3>Offline Data</h3>
            <p>Download all toilet data for offline use.</p>
            <div className={styles.row}>
              <span>Enable Offline Mode</span>
              <label className={styles.switch}>
                <input
                  type="checkbox"
                  checked={isToggleOn}
                  onChange={(e) => {
                    if (e.currentTarget.checked && !richDumpDownloaded) {
                      onDownloadOffline();
                    }
                  }}
                  disabled={isDownloading || richDumpDownloaded}
                />
                <span className={styles.slider} />
              </label>
            </div>
            {isDownloading && <div className={styles.progress}>{downloadProgress}</div>}
            {richDumpDownloaded && richDumpTimestamp && (
              <div className={styles.status}>
                Downloaded {new Date(richDumpTimestamp).toLocaleDateString()} at{" "}
                {new Date(richDumpTimestamp).toLocaleTimeString()}
              </div>
            )}
          </div>

          <div className={styles.section}>
            <h3>Developer</h3>
            <button type="button" className={styles.devToolsBtn} onClick={onOpenDevTools}>
              <i className="fa-solid fa-code" /> Open Developer Tools
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;
