import { PlusIcon, SettingsIcon } from './Icons';
import { ModelSelector } from './ModelSelector';

// The top bar: model selector on the left, new-chat + settings on the right.
interface Props {
  activeProviderId: string;
  activeModelId: string;
  configured: string[];
  onSelectModel: (providerId: string, modelId: string) => void;
  onNewChat: () => void;
  onOpenSettings: () => void;
}

export function TopBar({
  activeProviderId,
  activeModelId,
  configured,
  onSelectModel,
  onNewChat,
  onOpenSettings,
}: Props) {
  return (
    <header className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
      <ModelSelector
        activeProviderId={activeProviderId}
        activeModelId={activeModelId}
        configured={configured}
        onSelect={onSelectModel}
      />
      <div className="flex items-center gap-0.5">
        <button className="icon-btn" onClick={onNewChat} title="New chat" aria-label="New chat">
          <PlusIcon />
        </button>
        <button
          className="icon-btn"
          onClick={onOpenSettings}
          title="Settings"
          aria-label="Settings"
        >
          <SettingsIcon />
        </button>
      </div>
    </header>
  );
}
