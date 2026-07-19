import { defineManifest } from '@crxjs/vite-plugin';

// Single source of truth for the MV3 manifest. crxjs transforms the referenced
// TS entry points (background service worker, content script) into the built
// JS and rewrites paths at build time.
export default defineManifest({
  manifest_version: 3,
  name: 'AI Sidebar — Browser Agent',
  version: '0.1.0',
  description:
    'A deeply-integrated AI side panel with full browser-agent control over the DOM.',

  // The side panel is our primary UI surface (chrome.sidePanel API).
  side_panel: {
    default_path: 'index.html',
  },

  icons: {
    16: 'src/icons/icon-16.png',
    32: 'src/icons/icon-32.png',
    48: 'src/icons/icon-48.png',
    128: 'src/icons/icon-128.png',
  },

  action: {
    default_title: 'Open AI Sidebar',
    default_icon: {
      16: 'src/icons/icon-16.png',
      32: 'src/icons/icon-32.png',
      48: 'src/icons/icon-48.png',
      128: 'src/icons/icon-128.png',
    },
  },

  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },

  content_scripts: [
    {
      // Full read/write DOM access on every page. Runs in the ISOLATED world
      // (default) — full DOM control, no leakage of extension state into the
      // page's own JS. A MAIN-world bridge can be added later if page-JS
      // variable access is ever required (see src/content/index.ts).
      matches: ['<all_urls>'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
      all_frames: false,
    },
  ],

  permissions: [
    'sidePanel', // open/manage the side panel
    'storage', // persist chat history + settings + API keys (worker-only)
    'tabs', // read active tab metadata, route tool calls to the right tab
    'scripting', // inject/execute in tabs when a content script isn't present
    'activeTab', // elevated access to the user's current tab on invocation
    'identity', // chrome.identity.launchWebAuthFlow for provider sign-in (OAuth)
  ],

  // Broad host access is required for a "full browser control" agent. Narrow
  // this per deployment if you want to scope the agent to specific origins.
  host_permissions: ['<all_urls>'],

  minimum_chrome_version: '116', // chrome.sidePanel shipped in 114/116
});
