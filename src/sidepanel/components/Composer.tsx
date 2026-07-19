import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowUpIcon, PaperclipIcon, StopIcon } from './Icons';

// The floating composer. Auto-grows up to a max height, sends on Enter (Shift+
// Enter = newline). Purely presentational — it emits `onSend` / `onStop`.
interface Props {
  busy: boolean;
  disabled?: boolean;
  placeholder?: string;
  onSend: (text: string) => void;
  onStop: () => void;
}

export function Composer({ busy, disabled, placeholder, onSend, onStop }: Props) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize the textarea to fit its content.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
  }, [value]);

  const submit = () => {
    const text = value.trim();
    if (!text || busy || disabled) return;
    onSend(text);
    setValue('');
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
              {/* Attachment slot — wired as an extension point (page/screenshot
                  context injection). Left non-functional by design for now. */}
              <button
                className="icon-btn"
                title="Attach (coming soon)"
                aria-label="Attach"
                disabled
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
                disabled={!value.trim() || disabled}
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
