import styles from "./SettingsPanel.module.css";

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenDevTools: () => void;
}

const SettingsPanel = ({ isOpen, onClose, onOpenDevTools }: SettingsPanelProps) => {
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
