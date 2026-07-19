import { useCallback, useState } from 'react';
import { sendSettingsRpc } from '../lib/messaging';
import { ChatView } from './components/ChatView';
import { SettingsPanel } from './components/SettingsPanel';
import { usePanelPort } from './state/usePanelPort';

// Top-level shell. Owns only view routing (chat vs settings) and wiring the port
// state to the ChatView. All streaming/message logic lives in usePanelPort.
export default function App() {
  const [state, actions] = usePanelPort();
  // Initial view: chat, unless a ?view=settings deep-link is present (used by the
  // dev preview and future "open settings" links). No effect in the extension.
  const [view, setView] = useState<'chat' | 'settings'>(() =>
    typeof location !== 'undefined' && location.search.includes('view=settings')
      ? 'settings'
      : 'chat',
  );

  // Model selection writes through the settings RPC, then refreshes port state so
  // the redacted snapshot (active model + configured providers) updates.
  const onSelectModel = useCallback(
    async (providerId: string, modelId: string) => {
      await sendSettingsRpc({
        type: 'settings:update',
        patch: { activeProviderId: providerId, activeModelId: modelId },
      });
      actions.refresh();
    },
    [actions],
  );

  const closeSettings = useCallback(() => {
    setView('chat');
    actions.refresh(); // pick up any key/model changes made in settings
  }, [actions]);

  if (view === 'settings') {
    return <SettingsPanel onClose={closeSettings} />;
  }

  // Until the first state snapshot arrives, show a minimal placeholder.
  if (!state.conversation || !state.settings) {
    return (
      <div className="flex h-full items-center justify-center bg-bg text-sm text-fg-subtle">
        Connecting…
      </div>
    );
  }

  return (
    <ChatView
      conversation={state.conversation}
      activeProviderId={state.settings.activeProviderId}
      activeModelId={state.settings.activeModelId}
      configured={state.configured}
      busy={state.busy}
      error={state.error}
      onSend={actions.send}
      onStop={actions.stop}
      onNewChat={actions.clear}
      onSelectModel={onSelectModel}
      onOpenSettings={() => setView('settings')}
      onDismissError={actions.dismissError}
    />
  );
}
