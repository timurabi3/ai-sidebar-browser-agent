import type { ChatMessage } from '../../lib/types';
import { ToolCallCard } from './ToolCallCard';

// A single transcript row. User messages get the pill bubble; assistant messages
// render as plain flowing text (Claude-style). Tool-result messages are folded
// into their originating assistant message via `toolResults`, so they aren't
// rendered standalone here.
interface Props {
  message: ChatMessage;
  toolResults: Record<string, ChatMessage>; // toolCallId -> tool message
}

export function MessageBubble({ message, toolResults }: Props) {
  if (message.role === 'user') {
    return (
      <div className="animate-fade-in">
        <div className="bubble-user whitespace-pre-wrap">{message.content}</div>
      </div>
    );
  }

  if (message.role === 'assistant') {
    return (
      <div className="animate-fade-in space-y-2">
        {message.content && (
          <div className="bubble-assistant whitespace-pre-wrap">
            {message.content}
            {message.pending && (
              <span className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-blink bg-fg" />
            )}
          </div>
        )}
        {message.pending && !message.content && <ThinkingDots />}
        {message.toolCalls?.map((tc) => (
          <ToolCallCard key={tc.id} toolCall={tc} result={toolResults[tc.id]} />
        ))}
        {message.error && (
          <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {message.error}
          </div>
        )}
      </div>
    );
  }

  // tool + system messages are not rendered standalone.
  return null;
}

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 py-1 text-fg-subtle">
      <span className="h-1.5 w-1.5 animate-blink rounded-full bg-fg-subtle" />
      <span
        className="h-1.5 w-1.5 animate-blink rounded-full bg-fg-subtle"
        style={{ animationDelay: '0.2s' }}
      />
      <span
        className="h-1.5 w-1.5 animate-blink rounded-full bg-fg-subtle"
        style={{ animationDelay: '0.4s' }}
      />
    </div>
  );
}
