import { useEffect, useState } from 'react';
import { usingBuiltIn, getStatus, loadSettings, onStatus, saveSettings, signIn, signOut, storageUsage, syncNow, type SyncStatus } from '../lib/sync';
import { APP_VERSION, desktop } from '../lib/platform';
import { errText, formatBytes } from '../lib/util';
import { DEFAULT_SYNC } from '../config';

export function Settings({ onClose, onError }: { onClose: () => void; onError: (m: string) => void }) {
  const cur = loadSettings();
  const [url, setUrl] = useState(cur?.url ?? '');
  const [key, setKey] = useState(cur?.key ?? '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<SyncStatus>(getStatus());
  const [usage, setUsage] = useState(0);
  const [backupDir, setBackupDir] = useState('');
  const [working, setWorking] = useState(false);
  const [localErr, setLocalErr] = useState('');
  const [advanced, setAdvanced] = useState(!usingBuiltIn() && !!cur);

  useEffect(() => onStatus(setStatus), []);
  useEffect(() => { void storageUsage().then(setUsage); void desktop?.backupFolder().then(setBackupDir); }, []);

  const act = async (fn: () => Promise<void>) => {
    setWorking(true); setLocalErr('');
    try { await fn(); } catch (e) { setLocalErr(errText(e).split('\n')[0]); onError(errText(e)); } finally { setWorking(false); }
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>Settings</h2><button onClick={onClose}>Close</button></div>

        <h3>Sync status</h3>
        <p className={`status ${status.phase}`}>{status.message}</p>
        {status.lastSynced && <p className="small">Last synced {new Date(status.lastSynced).toLocaleString()}</p>}
        {status.email && <p className="small">Signed in as <b>{status.email}</b></p>}
        {status.problems.length > 0 && (
          <details open><summary>Sync problems ({status.problems.length})</summary>
            {status.problems.map((p, i) => <pre key={i} className="err">{p}</pre>)}
          </details>
        )}
        <p className="small">Attachments: {formatBytes(usage)} {usage > 900 * 1024 * 1024 && <b className="err"> — close to Supabase's free 1 GB file storage.</b>}</p>

        <h3>Sync database</h3>
        {cur && usingBuiltIn() && <p className="small">Connected to your PermaNotes database. Sign in below on each device with the same email and password.</p>}
        {!cur && <div className="row"><button disabled={working} onClick={() => act(() => saveSettings(DEFAULT_SYNC))}>Turn sync on</button></div>}
        <details open={advanced} onToggle={(e) => setAdvanced((e.target as HTMLDetailsElement).open)}>
          <summary className="small">Advanced: use a different Supabase project</summary>
          <label>Project URL<input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxxx.supabase.co" /></label>
          <label>Anon / publishable key<input value={key} onChange={(e) => setKey(e.target.value)} placeholder="eyJ… or sb_publishable_…" /></label>
          <div className="row">
            <button disabled={working} onClick={() => act(() => saveSettings({ url, key }))}>Save connection</button>
            <button disabled={working} onClick={() => act(() => saveSettings(DEFAULT_SYNC))}>Use built-in database</button>
            {cur && <button disabled={working} onClick={() => act(() => saveSettings(null))}>Turn sync off</button>}
          </div>
        </details>

        {cur && (
          <>
            <h3>Sign in</h3>
            {status.email ? (
              <div className="row">
                <button disabled={working} onClick={() => act(() => syncNow())}>Sync now</button>
                <button disabled={working} onClick={() => act(() => signOut())}>Sign out</button>
              </div>
            ) : (
              <>
                <p className="small">First device: "Create account". Every other device: "Sign in" with the same email and password.</p>
                <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" /></label>
                <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
                <div className="row">
                  <button disabled={working} onClick={() => act(() => signIn(email, password, false))}>Sign in</button>
                  <button disabled={working} onClick={() => act(() => signIn(email, password, true))}>Create account</button>
                </div>
              </>
            )}
          </>
        )}
        {localErr && <pre className="err">{localErr}</pre>}

        {desktop && (
          <>
            <h3>Automatic backups</h3>
            <p className="small">A full .pn backup of every note is kept for each day (refreshed every 15 minutes when something changed; last 14 days kept) in:<br /><code>{backupDir}</code></p>
            <button onClick={() => void desktop!.showBackupFolder()}>Show backup folder</button>
          </>
        )}
        <p className="small version">PermaNotes {APP_VERSION}</p>
      </div>
    </div>
  );
}
