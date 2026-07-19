import { useState } from 'react';
import type { ChatMessage, ToolCall } from '../../lib/types';
import { ChevronDownIcon, ToolIcon } from './Icons';

// Renders a compact, expandable card for a tool the agent used. Collapsed by
// default to keep the transcript readable; expand to inspect args + result.
interface Props {
  toolCall: ToolCall;
  result?: ChatMessage; // the matching tool-result message, if already produced
}

export function ToolCallCard({ toolCall, result }: Props) {
  const [open, setOpen] = useState(false);
  const isError = result?.toolResult?.isError;

  return (
    <div className="tool-card animate-fade-in">
      <button
        className="flex w-full items-center gap-2 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <ToolIcon width={14} height={14} className={isError ? 'text-danger' : 'text-accent'} />
        <span className="font-medium text-fg">{toolCall.name}</span>
        <span className="truncate text-fg-subtle">
          {summarizeArgs(toolCall.arguments)}
        </span>
        <ChevronDownIcon
          width={14}
          height={14}
          className={`ml-auto shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="mt-2 space-y-2 border-t border-border pt-2">
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-fg-subtle">args</div>
            <pre className="whitespace-pre-wrap break-words text-fg-muted">
              {JSON.stringify(toolCall.arguments, null, 2)}
            </pre>
          </div>
          {result?.toolResult && (
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-fg-subtle">
                result{isError ? ' (error)' : ''}
              </div>
              <pre
                className={`max-h-56 overflow-y-auto whitespace-pre-wrap break-words ${
                  isError ? 'text-danger' : 'text-fg-muted'
                }`}
              >
                {result.toolResult.content}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function summarizeArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return '';
  return entries
    .map(([k, v]) => `${k}: ${String(v).slice(0, 40)}`)
    .join(', ')
    .slice(0, 80);
}
