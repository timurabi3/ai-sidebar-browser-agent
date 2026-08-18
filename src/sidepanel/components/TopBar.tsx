import type { Conversation } from '../../lib/types';
import { SettingsIcon } from './Icons';
import { HistoryList } from './HistoryList';
import { ModelSelector } from './ModelSelector';

// The top bar: model selector on the left, history + settings on the right.
interface Props {
  activeProviderId: string;
  activeModelId: string;
  configured: string[];
  conversations: Conversation[];
  activeConversationId: string;
  onSelectModel: (providerId: string, modelId: string) => void;
  onNewConversation: () => void;
  onSwitchConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onOpenSettings: () => void;
}

export function TopBar({
  activeProviderId,
  activeModelId,
  configured,
  conversations,
  activeConversationId,
  onSelectModel,
  onNewConversation,
  onSwitchConversation,
  onDeleteConversation,
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
        <HistoryList
          conversations={conversations}
          activeId={activeConversationId}
          onNew={onNewConversation}
          onSwitch={onSwitchConversation}
          onDelete={onDeleteConversation}
        />
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
