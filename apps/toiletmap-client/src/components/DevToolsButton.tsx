import styles from "./DevToolsButton.module.css";

interface DevToolsButtonProps {
  onClick: () => void;
}

/**
 * Floating button to open developer tools.
 * Only visible in development and preview environments.
 */
const DevToolsButton = ({ onClick }: DevToolsButtonProps) => {
  return (
    <button
      type="button"
      className={styles.devToolsBtn}
      onClick={onClick}
      title="Developer Tools"
      aria-label="Open Developer Tools"
    >
      <i className="fa-solid fa-code" />
    </button>
  );
};

export default DevToolsButton;
