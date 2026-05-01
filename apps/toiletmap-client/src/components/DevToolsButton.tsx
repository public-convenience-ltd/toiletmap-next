import { IconButton } from "toiletmap-design-system";

interface DevToolsButtonProps {
  class?: string;
  onClick: () => void;
}

const DevToolsButton = ({ class: className, onClick }: DevToolsButtonProps) => (
  <IconButton
    icon="asterisk"
    aria-label="Developer Tools"
    variant="filled"
    class={className}
    onClick={onClick}
  />
);

export default DevToolsButton;
