import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CHAT_PORT,
  postToWorker,
  type WorkerToPanel,
} from '../../lib/messaging';
import type { ChatMessage, Conversation, Settings } from '../../lib/types';

// ─────────────────────────────────────────────────────────────────────────────
// The side panel's connection to the background worker. Encapsulates ALL of the
// streaming/message-passing logic so React components stay presentational:
// they receive `state` + a handful of action callbacks and render.
//
// Handles the MV3 service-worker lifecycle: if the worker goes idle and the
// port drops, we transparently reconnect and re-subscribe (the worker replies
// with a fresh full-state snapshot).
// ─────────────────────────────────────────────────────────────────────────────

export interface PanelState {
  conversation: Conversation | null;
  settings: Settings | null;
  /** Provider ids that have a key configured (no key values). */
  configured: string[];
  busy: boolean;
  error: string | null;
}

export interface PanelActions {
  send: (text: string) => void;
  stop: () => void;
  clear: () => void;
  dismissError: () => void;
  /** Re-pull state after settings changes elsewhere. */
  refresh: () => void;
}

const EMPTY: PanelState = {
  conversation: null,
  settings: null,
  configured: [],
  busy: false,
  error: null,
};

export function usePanelPort(): [PanelState, PanelActions] {
  const [state, setState] = useState<PanelState>(EMPTY);
  const portRef = useRef<chrome.runtime.Port | null>(null);

  // Merge a single incoming message into local conversation state.
  const applyMessage = useCallback(
    (mutator: (messages: ChatMessage[]) => ChatMessage[]) => {
      setState((prev) => {
        if (!prev.conversation) return prev;
        return {
          ...prev,
          conversation: {
            ...prev.conversation,
            messages: mutator(prev.conversation.messages),
          },
        };
      });
    },
    [],
  );

  const handleMessage = useCallback(
    (msg: WorkerToPanel) => {
      switch (msg.type) {
        case 'state':
          setState((prev) => ({
            ...prev,
            conversation: msg.conversation,
            settings: msg.settings,
            configured: msg.configured,
            busy: msg.busy,
          }));
          break;

        case 'message:add':
          applyMessage((messages) => {
            if (messages.some((m) => m.id === msg.message.id)) return messages;
            return [...messages, msg.message];
          });
          break;

        case 'message:update':
          applyMessage((messages) =>
            messages.map((m) => (m.id === msg.message.id ? msg.message : m)),
          );
          break;

        case 'stream':
          if (msg.event.type === 'text') {
            const delta = msg.event.delta;
            applyMessage((messages) =>
              messages.map((m) =>
                m.id === msg.messageId ? { ...m, content: m.content + delta } : m,
              ),
            );
          }
          break;

        case 'busy':
          setState((prev) => ({ ...prev, busy: msg.busy }));
          break;

        case 'error':
          setState((prev) => ({ ...prev, error: msg.message, busy: false }));
          break;
      }
    },
    [applyMessage],
  );

  const connect = useCallback(() => {
    const port = chrome.runtime.connect({ name: CHAT_PORT });
    portRef.current = port;
    port.onMessage.addListener(handleMessage as (m: unknown) => void);
    port.onDisconnect.addListener(() => {
      portRef.current = null;
      // Reconnect on the next tick — the worker likely just went idle.
      // connect() re-posts `state:subscribe`, so the panel resyncs on its own.
      setTimeout(() => {
        if (!portRef.current) connect();
      }, 250);
    });
    postToWorker(port, { type: 'state:subscribe' });
  }, [handleMessage]);

  useEffect(() => {
    connect();
    return () => {
      portRef.current?.disconnect();
      portRef.current = null;
    };
  }, [connect]);

  const send = useCallback((text: string) => {
    const port = portRef.current;
    if (!port) return;
    setState((prev) => ({ ...prev, error: null }));
    postToWorker(port, { type: 'chat:send', text });
  }, []);

  const stop = useCallback(() => {
    portRef.current && postToWorker(portRef.current, { type: 'chat:stop' });
  }, []);

  const clear = useCallback(() => {
    portRef.current && postToWorker(portRef.current, { type: 'chat:clear' });
  }, []);

  const dismissError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  const refresh = useCallback(() => {
    portRef.current && postToWorker(portRef.current, { type: 'state:subscribe' });
  }, []);

  return [state, { send, stop, clear, dismissError, refresh }];
}
