import { useLayoutEffect, useRef, useState } from 'react';
import type { PageContext } from '../../lib/types';
import { ArrowUpIcon, CloseIcon, PaperclipIcon, StopIcon } from './Icons';

// The floating composer. Auto-grows up to a max height, sends on Enter (Shift+
// Enter = newline). Presentational — it emits `onSend` (with an optional page
// attachment) / `onStop` / `onAttach` and keeps the attachment chip as local
// state until the message is sent.
interface Props {
  busy: boolean;
  disabled?: boolean;
  placeholder?: string;
  onSend: (text: string, attachment?: PageContext) => void;
  onStop: () => void;
  onAttach: () => Promise<PageContext | null>;
}

export function Composer({ busy, disabled, placeholder, onSend, onStop, onAttach }: Props) {
  const [value, setValue] = useState('');
  const [attachment, setAttachment] = useState<PageContext | null>(null);
  const [attaching, setAttaching] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize the textarea to fit its content.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
  }, [value]);

  const attach = async () => {
    if (attaching || disabled) return;
    setAttaching(true);
    const ctx = await onAttach();
    setAttaching(false);
    if (ctx) setAttachment(ctx);
  };

  const submit = () => {
    const text = value.trim();
    if ((!text && !attachment) || busy || disabled) return;
    onSend(text, attachment ?? undefined);
    setValue('');
    setAttachment(null);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="px-3 pb-3 pt-1">
      <div className="mx-auto max-w-3xl">
        <div className="composer">
          {attachment && (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-bg-subtle px-2.5 py-2 animate-fade-in">
              <PaperclipIcon width={14} height={14} className="shrink-0 text-fg-subtle" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-fg">
                  {attachment.title || 'Current page'}
                </p>
                <p className="truncate text-[11px] text-fg-subtle">
                  {attachment.url || 'No URL captured'}
                </p>
              </div>
              <button
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-bg-input hover:text-fg"
                onClick={() => setAttachment(null)}
                title="Remove attachment"
                aria-label="Remove attachment"
              >
                <CloseIcon width={13} height={13} />
              </button>
            </div>
          )}

          <textarea
            ref={textareaRef}
            rows={1}
            className="composer-textarea"
            placeholder={placeholder ?? 'Message the browser agent…'}
            value={value}
            disabled={disabled}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-0.5">
              <button
                className={`icon-btn ${attachment ? 'text-accent' : ''}`}
                title={attaching ? 'Attaching…' : 'Attach current page'}
                aria-label="Attach current page"
                disabled={attaching || disabled}
                onClick={attach}
              >
                <PaperclipIcon />
              </button>
            </div>

            {busy ? (
              <button className="btn-accent" onClick={onStop} title="Stop">
                <StopIcon width={14} height={14} />
                Stop
              </button>
            ) : (
              <button
                className="icon-btn bg-accent text-accent-fg hover:bg-accent-hover hover:text-accent-fg disabled:bg-bg-input disabled:text-fg-subtle"
                onClick={submit}
                disabled={(!value.trim() && !attachment) || disabled}
                title="Send"
                aria-label="Send"
              >
                <ArrowUpIcon width={18} height={18} />
              </button>
            )}
          </div>
        </div>
        <p className="mt-2 text-center text-[11px] leading-tight text-fg-subtle">
          Agent can read &amp; control this page · review its actions
        </p>
      </div>
    </div>
  );
}
