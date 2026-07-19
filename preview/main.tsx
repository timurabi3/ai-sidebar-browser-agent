// Design-preview entry. The chrome.* mock is installed by an inline script in
// preview/index.html <head> (runs before any module, sidestepping ES-import
// hoisting), so by the time this module and its App import evaluate, chrome.*
// already exists. This file only mounts the real side-panel App with seeded
// data so the redesign renders in a plain browser tab. Not shipped in dist/.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../src/sidepanel/App';
import '../src/styles/index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
