import { useState } from 'react';
import { PROVIDERS } from '../../lib/providers';
import type { ProviderDefinition } from '../../lib/types';
import { useSettings } from '../state/useSettings';
import { CheckIcon, CloseIcon } from './Icons';

// Full settings screen. Everything here talks to the worker via the settings RPC
// (useSettings). This is the only surface that holds raw API keys, and only while
// the user is editing them — they are written straight back to the worker.
interface Props {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: Props) {
  const { settings, loading, error, update, setKey, clearKey, setProviderConfig, signIn, clearOAuth } =
    useSettings();

  if (loading || !settings) {
    return (
      <Shell onClose={onClose}>
        <p className="text-sm text-fg-muted">Loading settings…</p>
      </Shell>
    );
  }

  return (
    <Shell onClose={onClose}>
      {error && (
        <div className="mb-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      {/* ── Agent behavior ─────────────────────────────────────────── */}
      <Section title="Agent">
        <div>
          <label className="field-label">System prompt</label>
          <textarea
            className="field-input min-h-[92px] resize-y"
            value={settings.systemPrompt}
            onChange={(e) => void update({ systemPrompt: e.target.value })}
          />
        </div>

        <div className="flex items-center justify-between">
          <label className="text-sm text-fg">Browser tools</label>
          <Toggle
            checked={settings.toolsEnabled}
            onChange={(v) => void update({ toolsEnabled: v })}
          />
        </div>

        <div>
          <label className="field-label">
            Temperature — {settings.temperature.toFixed(2)}
          </label>
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={settings.temperature}
            onChange={(e) => void update({ temperature: Number(e.target.value) })}
            className="w-full accent-accent"
          />
        </div>

        <div>
          <label className="field-label">Max tool iterations</label>
          <input
            type="number"
            min={1}
            max={30}
            className="field-input w-28"
            value={settings.maxToolIterations}
            onChange={(e) => void update({ maxToolIterations: Number(e.target.value) })}
          />
        </div>
      </Section>

      {/* ── API connectors ─────────────────────────────────────────── */}
      <Section title="API connectors">
        <p className="-mt-1 mb-2 text-xs text-fg-subtle">
          Keys are stored locally and only used by the extension's background worker.
          They are never sent to web pages.
        </p>
        <div className="space-y-3">
          {PROVIDERS.map((provider) => {
            const cfg = settings.providers[provider.id];
            return (
              <ProviderRow
                key={provider.id}
                provider={provider}
                hasKey={!!cfg?.apiKey}
                signedIn={!!cfg?.oauth}
                accountLabel={cfg?.oauth?.accountLabel}
                baseUrl={cfg?.baseUrl ?? ''}
                onSaveKey={(key) => void setKey(provider.id, key)}
                onClearKey={() => void clearKey(provider.id)}
                onSignIn={(clientId) => signIn(provider.id, clientId)}
                onClearOAuth={() => void clearOAuth(provider.id)}
                onSaveBaseUrl={(url) =>
                  void setProviderConfig(provider.id, { baseUrl: url || undefined })
                }
              />
            );
          })}
        </div>
      </Section>
    </Shell>
  );
}

// ── Provider row ─────────────────────────────────────────────────────────────

interface ProviderRowProps {
  provider: ProviderDefinition;
  hasKey: boolean;
  signedIn: boolean;
  accountLabel?: string;
  baseUrl: string;
  onSaveKey: (key: string) => void;
  onClearKey: () => void;
  onSignIn: (clientId?: string) => Promise<boolean>;
  onClearOAuth: () => void;
  onSaveBaseUrl: (url: string) => void;
}

function ProviderRow({
  provider,
  hasKey,
  signedIn,
  accountLabel,
  baseUrl,
  onSaveKey,
  onClearKey,
  onSignIn,
  onClearOAuth,
  onSaveBaseUrl,
}: ProviderRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  // Prefill the base-URL draft with the effective URL (override, else default),
  // so the field shows a real value and Save persists something meaningful —
  // rather than an empty draft over a greyed-out placeholder (the old Bug 4).
  const [urlDraft, setUrlDraft] = useState(baseUrl || provider.defaultBaseUrl);

  const connected = hasKey || signedIn;
  // Auth priority is "sign-in wins": when both exist, OAuth is the active method.
  const activeMethod: 'sign-in' | 'API key' | null = signedIn
    ? 'sign-in'
    : hasKey
      ? 'API key'
      : null;

  return (
    <div className="rounded-xl border border-border bg-bg-subtle p-3">
      <button
        className="flex w-full items-center justify-between"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="flex items-center gap-2 text-sm font-medium text-fg">
          {provider.label}
          {connected ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-medium text-success">
              <CheckIcon width={11} height={11} /> connected
            </span>
          ) : (
            provider.requiresKey && (
              <span className="rounded-full bg-bg-input px-2 py-0.5 text-[10px] text-fg-subtle">
                not connected
              </span>
            )
          )}
        </span>
        <span className="text-xs text-fg-subtle">{expanded ? 'hide' : 'edit'}</span>
      </button>

      {/* When both credentials are present, make the active one unambiguous. */}
      {hasKey && signedIn && (
        <p className="mt-1.5 text-[11px] text-fg-subtle">
          Using <span className="text-fg-muted">sign-in</span> (API key kept as fallback).
        </p>
      )}

      {expanded && (
        <div className="mt-3 space-y-4 border-t border-border pt-3">
          {/* ── Sign-in connector ─────────────────────────────────────── */}
          {provider.oauth && (
            <SignInBlock
              provider={provider}
              signedIn={signedIn}
              accountLabel={accountLabel}
              active={activeMethod === 'sign-in'}
              onSignIn={onSignIn}
              onClearOAuth={onClearOAuth}
            />
          )}

          {/* ── API key ───────────────────────────────────────────────── */}
          {provider.requiresKey && (
            <div>
              <label className="field-label">
                API key
                {activeMethod === 'API key' && (
                  <span className="ml-2 rounded bg-accent/15 px-1.5 py-0.5 text-[9px] font-medium normal-case text-accent">
                    active
                  </span>
                )}
              </label>
              <div className="flex gap-2">
                <input
                  type="password"
                  className="field-input font-mono"
                  placeholder={hasKey ? '•••••••••• (saved)' : 'Paste key…'}
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  className="btn-accent shrink-0"
                  disabled={!keyDraft.trim()}
                  onClick={() => {
                    onSaveKey(keyDraft.trim());
                    setKeyDraft('');
                  }}
                >
                  Save
                </button>
              </div>
              <div className="mt-1.5 flex items-center gap-3">
                {hasKey && (
                  <button className="text-xs text-danger hover:underline" onClick={onClearKey}>
                    Remove key
                  </button>
                )}
                {provider.apiKeyUrl && (
                  <a
                    href={provider.apiKeyUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-accent hover:underline"
                  >
                    Get a key ↗
                  </a>
                )}
              </div>
            </div>
          )}

          {/* ── Base URL override ─────────────────────────────────────── */}
          <div>
            <label className="field-label">Base URL</label>
            <div className="flex gap-2">
              <input
                className="field-input font-mono"
                placeholder={provider.defaultBaseUrl}
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
                spellCheck={false}
              />
              <button
                className="btn-ghost shrink-0"
                onClick={() => onSaveBaseUrl(urlDraft.trim())}
              >
                Save
              </button>
            </div>
            <p className="mt-1 text-[11px] text-fg-subtle">
              Default: <span className="font-mono">{provider.defaultBaseUrl}</span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sign-in block ─────────────────────────────────────────────────────────────

interface SignInBlockProps {
  provider: ProviderDefinition;
  signedIn: boolean;
  accountLabel?: string;
  active: boolean;
  onSignIn: (clientId?: string) => Promise<boolean>;
  onClearOAuth: () => void;
}

function SignInBlock({
  provider,
  signedIn,
  accountLabel,
  active,
  onSignIn,
  onClearOAuth,
}: SignInBlockProps) {
  const [busy, setBusy] = useState(false);
  const [clientId, setClientId] = useState('');
  const needsClientId = provider.oauth === 'google';
  const unsupported = provider.oauth === 'unsupported';

  const redirectHint = 'https://<extension-id>.chromiumapp.org/';

  return (
    <div className="rounded-lg border border-border bg-bg p-2.5">
      <div className="mb-2 flex items-center gap-2">
        <span className="field-label mb-0">Sign in</span>
        {active && (
          <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[9px] font-medium text-accent">
            active
          </span>
        )}
      </div>

      {unsupported ? (
        <p className="text-[11px] leading-relaxed text-fg-subtle">
          {provider.label} has no public sign-in for third-party apps — consumer/Pro
          subscriptions can't be connected this way. Use an API key above, or connect{' '}
          {provider.label} models through OpenRouter sign-in.
        </p>
      ) : signedIn ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-fg-muted">
            Connected{accountLabel ? ` · ${accountLabel}` : ''}
          </span>
          <button className="text-xs text-danger hover:underline" onClick={onClearOAuth}>
            Disconnect
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {needsClientId && (
            <div>
              <input
                className="field-input font-mono text-xs"
                placeholder="Google OAuth client ID"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                spellCheck={false}
              />
              <p className="mt-1 text-[10px] leading-snug text-fg-subtle">
                Create an OAuth 2.0 Web client in Google Cloud, add redirect URL{' '}
                <span className="font-mono">{redirectHint}</span>
              </p>
            </div>
          )}
          <button
            className="btn-ghost w-full justify-center border border-border"
            disabled={busy || (needsClientId && !clientId.trim())}
            onClick={async () => {
              setBusy(true);
              await onSignIn(needsClientId ? clientId.trim() : undefined);
              setBusy(false);
            }}
          >
            {busy ? 'Opening sign-in…' : `Connect ${provider.label}`}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Small presentational helpers ─────────────────────────────────────────────

function Shell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="flex h-full flex-col bg-bg">
      <header className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <h2 className="px-1 text-sm font-semibold text-fg">Settings</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close settings">
          <CloseIcon />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-2xl space-y-6">{children}</div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">{title}</h3>
      {children}
    </section>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full transition-colors ${
        checked ? 'bg-accent' : 'bg-bg-input'
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
          checked ? 'translate-x-[22px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}
