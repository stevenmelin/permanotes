import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { load } from './lib/store';
import { requestPersistence } from './lib/db';
import { startSync, onStatus } from './lib/sync';
import { dailyBackup } from './lib/pnio';
import { desktop, SOLO_NOTE } from './lib/platform';
import { errText } from './lib/util';
import { installPinchToTextSize } from './lib/viewprefs';

const root = document.getElementById('root')!;

function showFatal(e: unknown) {
  root.innerHTML = '';
  const pre = document.createElement('pre');
  pre.className = 'fatal';
  pre.textContent = `PermaNotes could not start:\n\n${errText(e)}`;
  root.append(pre);
}

window.addEventListener('unhandledrejection', (ev) => { console.error('Unhandled:', ev.reason); });

async function boot() {
  installPinchToTextSize();
  await requestPersistence();
  await load();
  createRoot(root).render(<StrictMode><App /></StrictMode>);
  // note windows leave syncing and backups to the main window (their edits reach it instantly)
  if (SOLO_NOTE) return;
  await startSync();
  if (desktop) {
    const backup = async () => {
      try { await dailyBackup(); } catch (e) { window.dispatchEvent(new CustomEvent('pn-error', { detail: `Daily backup failed: ${errText(e)}` })); }
    };
    let didFirst = false;
    onStatus((s) => { if (!didFirst && s.phase !== 'syncing') { didFirst = true; void backup(); } });
    setInterval(() => void backup(), 15 * 60 * 1000);
    window.addEventListener('beforeunload', () => void backup());
  }
  if ('serviceWorker' in navigator && !desktop && location.protocol === 'https:') {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((e) => console.error('Offline support failed to install:', e));
  }
}

boot().catch(showFatal);
