import { useEffect, useRef, useState } from 'react';
import type { Conversation } from '../../lib/types';
import { HistoryIcon, PlusIcon, TrashIcon } from './Icons';

// Conversation history dropdown, anchored in the top bar. Presentational: it
// receives the list + callbacks and only manages its own open/close state (like
// ModelSelector). New chat lives at the top; each row switches, hover reveals a
// delete affordance.
interface Props {
  conversations: Conversation[];
  activeId: string;
  onNew: () => void;
  onSwitch: (id: string) => void;
  onDelete: (id: string) => void;
}

export function HistoryList({ conversations, activeId, onNew, onSwitch, onDelete }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        className="icon-btn"
        onClick={() => setOpen((v) => !v)}
        title="Chat history"
        aria-label="Chat history"
        aria-expanded={open}
      >
        <HistoryIcon />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-1.5 w-72 rounded-xl border border-border bg-bg-elevated py-1.5 shadow-panel animate-fade-in">
          <div className="px-1.5 pb-1">
            <button
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-fg transition-colors hover:bg-bg-input"
              onClick={() => {
                onNew();
                setOpen(false);
              }}
            >
              <PlusIcon width={15} height={15} className="text-fg-muted" />
              New chat
            </button>
          </div>

          <div className="border-t border-border" />

          {conversations.length === 0 ? (
            <p className="px-3 py-2 text-xs text-fg-subtle">No conversations yet.</p>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto py-1">
              {conversations.map((c) => (
                <div key={c.id} className="group flex items-center gap-0.5 px-1.5">
                  <button
                    className={`min-w-0 flex-1 truncate rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-bg-input ${
                      c.id === activeId ? 'text-fg' : 'text-fg-muted'
                    }`}
                    onClick={() => {
                      onSwitch(c.id);
                      setOpen(false);
                    }}
                    title={c.title || 'New chat'}
                  >
                    {c.title || 'New chat'}
                  </button>
                  <button
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-bg-input hover:text-danger"
                    onClick={() => onDelete(c.id)}
                    title="Delete conversation"
                    aria-label={`Delete ${c.title || 'New chat'}`}
                  >
                    <TrashIcon width={14} height={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
