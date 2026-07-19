import type { Conversation } from '../../lib/types';
import { getProviderDefinition } from '../../lib/providers';
import { AlertIcon, CloseIcon } from './Icons';
import { Composer } from './Composer';
import { EmptyState } from './EmptyState';
import { MessageList } from './MessageList';
import { TopBar } from './TopBar';

// Composes the whole chat surface from presentational parts. Receives state and
// action callbacks from App — no message-passing or fetch logic lives here.
interface Props {
  conversation: Conversation;
  activeProviderId: string;
  activeModelId: string;
  configured: string[];
  busy: boolean;
  error: string | null;
  onSend: (text: string) => void;
  onStop: () => void;
  onNewChat: () => void;
  onSelectModel: (providerId: string, modelId: string) => void;
  onOpenSettings: () => void;
  onDismissError: () => void;
}

export function ChatView(props: Props) {
  const {
    conversation,
    activeProviderId,
    activeModelId,
    configured,
    busy,
    error,
    onSend,
    onStop,
    onNewChat,
    onSelectModel,
    onOpenSettings,
    onDismissError,
  } = props;

  const def = getProviderDefinition(activeProviderId);
  const needsKey = !!def?.requiresKey && !configured.includes(activeProviderId);
  const isEmpty = conversation.messages.length === 0;

  return (
    <div className="flex h-full flex-col bg-bg">
      <TopBar
        activeProviderId={activeProviderId}
        activeModelId={activeModelId}
        configured={configured}
        onSelectModel={onSelectModel}
        onNewChat={onNewChat}
        onOpenSettings={onOpenSettings}
      />

      {isEmpty ? (
        <EmptyState onExample={onSend} needsKey={needsKey} onOpenSettings={onOpenSettings} />
      ) : (
        <MessageList messages={conversation.messages} />
      )}

      {error && (
        <div className="mx-3 mb-2 flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          <AlertIcon width={16} height={16} className="mt-0.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={onDismissError} aria-label="Dismiss" className="shrink-0">
            <CloseIcon width={14} height={14} />
          </button>
        </div>
      )}

      <Composer busy={busy} onSend={onSend} onStop={onStop} />
    </div>
  );
}
