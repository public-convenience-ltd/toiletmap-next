import { Button, Icon, IconButton, Sheet } from "toiletmap-design-system";
import styles from "./SettingsPanel.module.css";

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenDevTools: () => void;
}

const SettingsPanel = ({ isOpen, onClose, onOpenDevTools }: SettingsPanelProps) => (
  <Sheet side="right" visible={isOpen} onClose={onClose} zIndex={2000}>
    <div className={styles.header}>
      <h2>Settings</h2>
      <IconButton icon="xmark" aria-label="Close settings" onClick={onClose} />
    </div>
    <div className={styles.content}>
      <div className={styles.section}>
        <h3>Developer</h3>
        <Button htmlElement="button" variant="secondary" onClick={onOpenDevTools}>
          <Icon icon="gear" size="medium" />
          Open Developer Tools
        </Button>
      </div>
    </div>
  </Sheet>
);

export default SettingsPanel;
