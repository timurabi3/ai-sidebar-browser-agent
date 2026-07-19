import { useCallback, useEffect, useState } from 'react';
import { sendSettingsRpc } from '../../lib/messaging';
import type { Settings } from '../../lib/types';

// Hook backing the settings screen. Talks to the worker over the one-shot
// settings RPC (separate from the streaming port). This is the only place the
// UI ever holds raw API keys, and only because the user is actively editing them.
export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await sendSettingsRpc({ type: 'settings:get' });
    if (res.ok) setSettings(res.settings);
    else setError(res.error);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const update = useCallback(async (patch: Partial<Settings>) => {
    const res = await sendSettingsRpc({ type: 'settings:update', patch });
    if (res.ok) setSettings(res.settings);
    else setError(res.error);
  }, []);

  const setKey = useCallback(async (providerId: string, apiKey: string) => {
    const res = await sendSettingsRpc({ type: 'settings:setKey', providerId, apiKey });
    if (res.ok) setSettings(res.settings);
    else setError(res.error);
  }, []);

  const clearKey = useCallback(async (providerId: string) => {
    const res = await sendSettingsRpc({ type: 'settings:clearKey', providerId });
    if (res.ok) setSettings(res.settings);
    else setError(res.error);
  }, []);

  // Patch non-secret provider config (baseUrl, extraHeaders) — never the key.
  const setProviderConfig = useCallback(
    async (providerId: string, config: { baseUrl?: string }) => {
      const res = await sendSettingsRpc({
        type: 'settings:setProviderConfig',
        providerId,
        config,
      });
      if (res.ok) setSettings(res.settings);
      else setError(res.error);
    },
    [],
  );

  const clearOAuth = useCallback(async (providerId: string) => {
    const res = await sendSettingsRpc({ type: 'settings:clearOAuth', providerId });
    if (res.ok) setSettings(res.settings);
    else setError(res.error);
  }, []);

  // Trigger the interactive sign-in flow (runs in the worker). Returns true on
  // success so the caller can reflect connect state; sets error otherwise.
  const signIn = useCallback(
    async (providerId: string, clientId?: string): Promise<boolean> => {
      setError(null);
      const res = await sendSettingsRpc({ type: 'settings:signIn', providerId, clientId });
      if (res.ok) {
        setSettings(res.settings);
        return true;
      }
      setError(res.error);
      return false;
    },
    [],
  );

  return {
    settings,
    loading,
    error,
    reload: load,
    update,
    setKey,
    clearKey,
    setProviderConfig,
    signIn,
    clearOAuth,
  };
}
