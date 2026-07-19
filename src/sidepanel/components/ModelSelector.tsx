import { useEffect, useRef, useState } from 'react';
import { PROVIDERS } from '../../lib/providers';
import { CheckIcon, ChevronDownIcon } from './Icons';

// Top-left model picker. Presentational: it receives the active provider/model
// and the set of configured providers, and calls back on selection. No RPC here.
interface Props {
  activeProviderId: string;
  activeModelId: string;
  configured: string[];
  onSelect: (providerId: string, modelId: string) => void;
}

export function ModelSelector({ activeProviderId, activeModelId, configured, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const activeProvider = PROVIDERS.find((p) => p.id === activeProviderId);
  const activeModel = activeProvider?.models.find((m) => m.id === activeModelId);
  const label = activeModel?.label ?? activeModelId ?? 'Select model';

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
      <button className="model-chip" onClick={() => setOpen((v) => !v)} title="Choose model">
        <span className="font-medium text-fg">{label}</span>
        <ChevronDownIcon width={14} height={14} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1.5 max-h-[70vh] w-72 overflow-y-auto rounded-xl border border-border bg-bg-elevated py-1.5 shadow-panel animate-fade-in">
          {PROVIDERS.map((provider) => {
            const hasKey = configured.includes(provider.id) || !provider.requiresKey;
            return (
              <div key={provider.id} className="px-1.5 py-1">
                <div className="flex items-center justify-between px-2.5 py-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
                    {provider.label}
                  </span>
                  {!hasKey && (
                    <span className="text-[10px] text-fg-subtle">no key</span>
                  )}
                </div>
                {provider.models.map((model) => {
                  const active =
                    provider.id === activeProviderId && model.id === activeModelId;
                  return (
                    <button
                      key={model.id}
                      className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-bg-input ${
                        hasKey ? 'text-fg' : 'text-fg-subtle'
                      }`}
                      onClick={() => {
                        onSelect(provider.id, model.id);
                        setOpen(false);
                      }}
                    >
                      <span className="truncate">{model.label}</span>
                      {active && <CheckIcon width={15} height={15} className="text-accent" />}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
