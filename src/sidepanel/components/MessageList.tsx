import { useEffect, useMemo, useRef } from 'react';
import type { ChatMessage } from '../../lib/types';
import { MessageBubble } from './MessageBubble';

// Scrollable transcript. Auto-scrolls to the bottom as new content streams in,
// unless the user has scrolled up to read history.
interface Props {
  messages: ChatMessage[];
}

export function MessageList({ messages }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // Index tool-result messages by the tool call id they answer, so each
  // assistant message can render its own tool cards inline.
  const toolResults = useMemo(() => {
    const map: Record<string, ChatMessage> = {};
    for (const m of messages) {
      if (m.role === 'tool' && m.toolResult) map[m.toolResult.toolCallId] = m;
    }
    return map;
  }, [messages]);

  useEffect(() => {
    if (stickToBottom.current) {
      bottomRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [messages]);

  const onScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottom.current = distanceFromBottom < 80;
  };

  const visible = messages.filter((m) => m.role === 'user' || m.role === 'assistant');

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      className="flex-1 overflow-y-auto px-4 py-4"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        {visible.map((m) => (
          <MessageBubble key={m.id} message={m} toolResults={toolResults} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
