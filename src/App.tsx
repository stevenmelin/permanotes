import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Editor } from './components/Editor';
import { PromptHost, askText } from './components/Prompt';
import { NoteList, DRAG_TYPE, type SortMode } from './components/NoteList';
import { Settings } from './components/Settings';
import { ImportDialog } from './components/ImportDialog';
import * as store from './lib/store';
import { exportFolder, exportLibrary, exportNote, importPn } from './lib/pnio';
import { onStatus, type SyncStatus } from './lib/sync';
import { desktop, pickFiles } from './lib/platform';
import { syncToDevices } from './lib/sync';
import type { Folder, Note } from './lib/types';
import { errText, stripHtml } from './lib/util';

type View = { type: 'all' } | { type: 'folder'; id: string } | { type: 'tag'; tag: string } | { type: 'trash' };
type Pane = 'nav' | 'list' | 'note';

const textCache = new Map<string, { at: string; text: string }>();
function noteText(n: Note) {
  const c = textCache.get(n.id);
  if (c && c.at === n.updated_at) return c.text;
  const text = `${n.title} ${n.tags.join(' ')} ${stripHtml(n.html)}`.toLowerCase();
  textCache.set(n.id, { at: n.updated_at, text });
  return text;
}

interface LayoutT { folders: boolean; list: boolean; toolbar: boolean; focus: boolean; width: number | null }
function loadLayout(): LayoutT {
  try { return { folders: true, list: true, toolbar: true, focus: false, width: null as number | null, ...JSON.parse(localStorage.getItem('pn.layout') ?? '{}') }; }
  catch { return { folders: true, list: true, toolbar: true, focus: false, width: null as number | null }; }
}
type Layout = LayoutT;

function loadExpanded(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem('pn.expanded') ?? '[]') as string[]); } catch { return new Set(); }
}

export default function App() {
  useSyncExternalStore(store.subscribe, store.getVersion);
  const [view, setView] = useState<View>({ type: 'all' });
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sortMode, setSortModeState] = useState<SortMode>(() => (localStorage.getItem('pn.sortMode') as SortMode) || 'custom');
  const setSortMode = (m: SortMode) => { localStorage.setItem('pn.sortMode', m); setSortModeState(m); };
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [dropFolder, setDropFolder] = useState<string | null>(null);
  const [pane, setPane] = useState<Pane>('list');
  const [expanded, setExpanded] = useState<Set<string>>(loadExpanded);
  const [errors, setErrors] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [menuCmd, setMenuCmd] = useState<{ id: string; n: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [layout, setLayoutState] = useState<Layout>(loadLayout);
  const setLayout = (p: Partial<Layout>) => setLayoutState((l) => { const n = { ...l, ...p }; localStorage.setItem('pn.layout', JSON.stringify(n)); return n; });
  // One-pane-at-a-time layout: iPhone, or a desktop window squeezed very narrow
  const NARROW_Q = `(max-width: ${desktop ? 480 : 760}px)`;
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW_Q).matches);
  useEffect(() => {
    const mq = window.matchMedia(NARROW_Q);
    const h = () => setNarrow(mq.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);
  // On iPhone the panes are pages you swipe between, so the desktop show/hide settings don't apply.
  const showFolders = narrow || (layout.folders && !layout.focus);
  const showList = narrow || (layout.list && !layout.focus);

  const fail = (m: string) => setErrors((e) => [...e, m]);
  const say = (m: string) => { setToast(m); setTimeout(() => setToast((t) => (t === m ? null : t)), 6000); };

  useEffect(() => onStatus(setSync), []);
  useEffect(() => {
    const h = (e: Event) => fail(String((e as CustomEvent).detail));
    window.addEventListener('pn-error', h);
    return () => window.removeEventListener('pn-error', h);
  }, []);
  useEffect(() => { localStorage.setItem('pn.expanded', JSON.stringify([...expanded])); }, [expanded]);

  // .pn files opened from Explorer/Finder or dropped on the window
  useEffect(() => {
    const open = async (name: string, bytes: Uint8Array | ArrayBuffer) => {
      try { setBusy(`Opening ${name}…`); say(await importPn(bytes, null)); } catch (e) { fail(`Opening ${name} failed: ${errText(e)}`); } finally { setBusy(null); }
    };
    if (desktop) {
      void desktop.pendingFiles().then((fs) => fs.forEach((f) => void open(f.name, f.bytes)));
      desktop.onOpenFile((f) => void open(f.name, f.bytes));
    }
    const over = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); };
    const drop = (e: DragEvent) => {
      const pn = [...(e.dataTransfer?.files ?? [])].filter((f) => f.name.toLowerCase().endsWith('.pn'));
      if (!pn.length) return;
      e.preventDefault();
      for (const f of pn) void f.arrayBuffer().then((b) => open(f.name, b));
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('drop', drop); };
  }, []);

  const folders = store.liveFolders();
  const childrenOf = (pid: string | null) => folders.filter((f) => f.parent_id === pid).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));

  const list = useMemo(() => {
    let ns: Note[];
    if (view.type === 'trash') ns = [...store.state.notes.values()].filter((n) => n.deleted);
    else {
      ns = store.liveNotes();
      if (view.type === 'folder') { const ids = store.descendantFolderIds(view.id); ns = ns.filter((n) => n.folder_id && ids.includes(n.folder_id)); }
      if (view.type === 'tag') ns = ns.filter((n) => n.tags.includes(view.tag));
    }
    const q = query.trim().toLowerCase();
    if (q) { const words = q.split(/\s+/); ns = ns.filter((n) => { const t = noteText(n); return words.every((w) => t.includes(w)); }); }
    return ns;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.getVersion(), view, query]);

  const note = selected ? store.state.notes.get(selected) ?? null : null;

  // File / View menu (desktop) and keyboard shortcuts
  useEffect(() => {
    desktop?.onMenu((id) => setMenuCmd((m) => ({ id, n: (m?.n ?? 0) + 1 })));
    const key = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      let id: string | null = null;
      if (e.key === 'Escape' && document.querySelector('.app.focus') && !document.querySelector('.modal')) id = 'exit-focus';
      else if (desktop) id = null; // desktop: the File/View menu accelerators handle the rest
      else if (mod && e.shiftKey && e.key.toLowerCase() === 'f') id = 'toggle-focus';
      else if (mod && !e.shiftKey && e.key === '1') id = 'toggle-folders';
      else if (mod && !e.shiftKey && e.key === '2') id = 'toggle-list';
      else if (mod && !e.shiftKey && e.key === '3') id = 'toggle-toolbar';
      else if (!desktop && mod && !e.shiftKey && e.key.toLowerCase() === 's') id = 'save-note';
      if (id) { e.preventDefault(); setMenuCmd((m) => ({ id: id!, n: (m?.n ?? 0) + 1 })); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const currentFolder = view.type === 'folder' ? view.id : null;

  const run = async (label: string, fn: () => Promise<unknown>) => {
    try { setBusy(label); await fn(); } catch (e) { fail(`${label.replace(/…$/, '')} failed: ${errText(e)}`); } finally { setBusy(null); }
  };

  const newNote = () => run('Creating note…', async () => {
    const n = await store.createNote(currentFolder, '', '<p></p>', view.type === 'tag' ? [view.tag] : []);
    setSelected(n.id); setPane('note');
  });

  const newFolder = async (parent: string | null) => {
    const name = await askText(parent ? 'New subfolder name' : 'New folder name');
    if (!name?.trim()) return;
    await run('Creating folder…', async () => {
      const f = await store.createFolder(name.trim(), parent);
      if (parent) setExpanded((s) => new Set(s).add(parent));
      setView({ type: 'folder', id: f.id });
    });
  };

  const [menuFor, setMenuFor] = useState<string | null>(null);
  const folderActions = (f: Folder) => (
    <div className="folder-menu" onClick={(e) => e.stopPropagation()}>
      <button onClick={() => { setMenuFor(null); void newFolder(f.id); }}>New subfolder</button>
      <button onClick={() => { setMenuFor(null); void askText('Rename folder', f.name).then((n) => { if (n?.trim()) void run('Renaming…', () => store.updateFolder(f.id, { name: n.trim() })); }); }}>Rename</button>
      <button onClick={() => { setMenuFor(null); void run('Saving folder…', async () => { const p = await exportFolder(f.id); if (p) say(`Saved ${p}`); }); }}>Save folder as .pn</button>
      <button className="danger" onClick={() => { setMenuFor(null); if (window.confirm(`Delete "${f.name}" and move all its notes to Trash?`)) void run('Deleting…', async () => { await store.deleteFolder(f.id); setView({ type: 'all' }); }); }}>Delete folder</button>
    </div>
  );

  useEffect(() => {
    if (!menuCmd) return;
    const cur = selected ? store.state.notes.get(selected) : undefined;
    switch (menuCmd.id) {
      case 'new-note': void newNote(); break;
      case 'new-folder': void newFolder(view.type === 'folder' ? view.id : null); break;
      case 'import-onenote': setShowImport(true); break;
      case 'open-pn': void pickFiles('.pn', true).then((fs) => fs.forEach((f) => void run(`Opening ${f.name}…`, async () => say(await importPn(await f.arrayBuffer(), view.type === 'folder' ? view.id : null))))); break;
      case 'save-note': if (cur && !cur.deleted) void run('Saving note…', async () => { const p = await exportNote(cur.id); if (p) say(`Saved ${p}`); }); else fail('Save note: select a note first.'); break;
      case 'save-folder': if (view.type === 'folder') void run('Saving folder…', async () => { const p = await exportFolder(view.id); if (p) say(`Saved ${p}`); }); else fail('Save folder: select a folder on the left first.'); break;
      case 'save-all': void run('Saving library…', async () => { const p = await exportLibrary(); if (p) say(`Saved ${p}`); }); break;
      case 'sync-now': syncToAll(); break;
      case 'settings': setShowSettings(true); break;
      case 'backup-folder': void desktop?.showBackupFolder().catch((e) => fail(errText(e))); break;
      case 'toggle-folders': setLayout({ folders: !layout.folders, focus: false }); break;
      case 'toggle-list': setLayout({ list: !layout.list, focus: false }); break;
      case 'toggle-toolbar': setLayout({ toolbar: !layout.toolbar }); break;
      case 'toggle-focus': setLayout({ focus: !layout.focus }); break;
      case 'exit-focus': setLayout({ focus: false }); break;
      case 'reset-width': setLayout({ width: null }); break;
      default: fail(`Unknown menu command: ${menuCmd.id}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuCmd]);

  const renderFolder = (f: Folder, depth: number) => {
    const kids = childrenOf(f.id);
    const open = expanded.has(f.id);
    const active = view.type === 'folder' && view.id === f.id;
    return (
      <div key={f.id}>
        <div className={`nav-item${active ? ' active' : ''}${dropFolder === f.id ? ' drop-target' : ''}`} style={{ paddingLeft: 8 + depth * 14 }}
          onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropFolder(f.id); } }}
          onDragLeave={() => setDropFolder((d) => (d === f.id ? null : d))}
          onDrop={(e) => {
            e.preventDefault(); setDropFolder(null);
            const ids = JSON.parse(e.dataTransfer.getData(DRAG_TYPE) || '[]') as string[];
            if (ids.length) void run('Moving…', async () => { await store.updateNotes(ids.map((id) => ({ id, patch: { folder_id: f.id } }))); say(`Moved ${ids.length} note(s) to ${f.name}`); });
          }}
          onClick={() => { setView({ type: 'folder', id: f.id }); setPane('list'); }}>
          <span className="twisty" onClick={(e) => { e.stopPropagation(); setExpanded((s) => { const n = new Set(s); if (n.has(f.id)) n.delete(f.id); else n.add(f.id); return n; }); }}>
            {kids.length ? (open ? '▾' : '▸') : ''}
          </span>
          <span className="nav-label">📁 {f.name}</span>
          <button className="mini" title="Folder options" onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === f.id ? null : f.id); }}>⋯</button>
        </div>
        {menuFor === f.id && folderActions(f)}
        {open && kids.map((k) => renderFolder(k, depth + 1))}
      </div>
    );
  };

  const syncLabel = !sync ? '' : sync.phase === 'syncing' ? `⟳ ${sync.progress != null ? Math.round(sync.progress * 100) + '%' : 'Syncing…'}`
    : sync.phase === 'synced' ? '✓ Sync to Devices' : sync.phase === 'offline' ? '⚡ Offline' : sync.phase === 'error' ? '⚠ Sync to Devices' : 'Sign in to sync';
  const syncToAll = () => {
    if (!sync || sync.phase === 'not-set-up' || sync.phase === 'signed-out') { setShowSettings(true); return; }
    void run('Syncing to devices…', async () => { await syncToDevices(); say('This device now matches your other devices.'); });
  };
  const syncBadge = sync ? (
    <button className={`sync ${sync.phase}`} title={`${sync.message}\nClick: make this device match your other devices.`} onClick={syncToAll} disabled={sync.phase === 'syncing'}>{syncLabel}</button>
  ) : null;

  const viewTitle = view.type === 'all' ? 'All notes' : view.type === 'trash' ? 'Trash' : view.type === 'tag' ? `#${view.tag}` : store.folderPath(view.id);

  return (
    <div className={`app pane-${pane}${narrow ? ' narrow' : ''}${layout.focus && !narrow ? ' focus' : ''}`}>
      {(!layout.focus || narrow) && <header>
        <button className="only-mobile" onClick={() => setPane(pane === 'note' ? 'list' : 'nav')}>{pane === 'note' ? '‹ Notes' : '☰'}</button>
        <strong className="brand">PermaNotes</strong>
        <span className="spacer" />
        {syncBadge}
        <button onClick={() => setShowImport(true)}>Import</button>
        <button onClick={() => void run('Saving library…', async () => { const p = await exportLibrary(); if (p) say(`Saved ${p}`); })}>Save all .pn</button>
        <button onClick={() => setShowSettings(true)}>⚙</button>
      </header>}
      {errors.length > 0 && (
        <div className="errors">
          {errors.map((e, i) => <pre key={i}>{e}</pre>)}
          <button onClick={() => setErrors([])}>Dismiss</button>
        </div>
      )}
      {busy && <div className="busy"><div className="bar indeterminate" /> {busy}</div>}
      {toast && <div className="toast" onClick={() => setToast(null)}>{toast}</div>}
      <main style={{ gridTemplateColumns: `${showFolders ? 'min(250px, 26vw) ' : ''}${showList ? 'min(300px, 32vw) ' : ''}minmax(0, 1fr)` }}>
        {showFolders && <nav className="sidebar">
          <div className={view.type === 'all' ? 'nav-item active' : 'nav-item'} onClick={() => { setView({ type: 'all' }); setPane('list'); }}>🗂 All notes <span className="count">{store.liveNotes().length}</span></div>
          <div className="nav-head">Folders <button className="mini" title="New folder" onClick={() => void newFolder(null)}>＋</button></div>
          {childrenOf(null).map((f) => renderFolder(f, 0))}
          {folders.length === 0 && <div className="hint">No folders yet. Click ＋ or import your OneNote notes.</div>}
          <div className="nav-head">Tags</div>
          {store.allTags().map((t) => (
            <div key={t} className={view.type === 'tag' && view.tag === t ? 'nav-item active' : 'nav-item'} onClick={() => { setView({ type: 'tag', tag: t }); setPane('list'); }}># {t}</div>
          ))}
          <div className="nav-head" />
          <div className={view.type === 'trash' ? 'nav-item active' : 'nav-item'} onClick={() => { setView({ type: 'trash' }); setPane('list'); }}>🗑 Trash</div>
        </nav>}
        {showList && <section className="list">
          <div className="list-head">
            <div className="list-title">{viewTitle}</div>
            <input type="search" placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <div className="list-actions">
              {view.type !== 'trash' && <button onClick={newNote}>＋ New note</button>}
            </div>
          </div>
          <NoteList notes={list} showFolder={view.type !== 'folder'} trash={view.type === 'trash'} openId={selected}
            selection={selection} setSelection={setSelection} onOpen={(id) => { setSelected(id); setPane('note'); }}
            sortMode={sortMode} setSortMode={setSortMode} run={run}
            snippet={(n) => noteText(n).slice(n.title.length + n.tags.join(' ').length + 2, n.title.length + 120)} />
        </section>}
        <section className="note">
          {note && !note.deleted && (
            <>
              <div className="note-bar">
                <span className="pane-toggles">
                  {!layout.focus && <>
                    <button className={layout.folders ? 'tb on' : 'tb'} title="Show/hide folders (Ctrl+1)" onClick={() => setLayout({ folders: !layout.folders })}>📁</button>
                    <button className={layout.list ? 'tb on' : 'tb'} title="Show/hide note list (Ctrl+2)" onClick={() => setLayout({ list: !layout.list })}>☰</button>
                  </>}
                  <button className={layout.toolbar ? 'tb on' : 'tb'} title="Show/hide formatting toolbar (Ctrl+3)" onClick={() => setLayout({ toolbar: !layout.toolbar })}>Aa</button>
                </span>
                <select value={note.folder_id ?? ''} onChange={(e) => void run('Moving…', () => store.updateNote(note.id, { folder_id: e.target.value || null }))}>
                  <option value="">(No folder)</option>
                  {folders.map((f) => ({ f, p: store.folderPath(f.id) })).sort((a, b) => a.p.localeCompare(b.p)).map(({ f, p }) => <option key={f.id} value={f.id}>{p}</option>)}
                </select>
                <span className="spacer" />
                <button className={store.isPinned(note) ? 'tb on' : 'tb'} title={store.isPinned(note) ? `Pinned #${note.pinned} — click to unpin` : 'Pin to the top of the list'}
                  onClick={() => void run('Pinning…', () => store.pinNotes([note.id], !store.isPinned(note)))}>📌{store.isPinned(note) ? ` #${note.pinned}` : ''}</button>
                <button className="tb" title={layout.focus ? 'Exit full page (Esc)' : 'Full page view (Ctrl+Shift+F)'} onClick={() => setLayout({ focus: !layout.focus })}>{layout.focus ? '⤡' : '⤢'}</button>
                <button onClick={() => { if (window.confirm('Move this note to Trash?')) void run('Deleting…', async () => { await store.updateNote(note.id, { deleted: true }); setSelected(null); setPane('list'); }); }}>Delete</button>
              </div>
              <Editor note={note} onError={fail} showToolbar={layout.toolbar} textWidth={layout.width} onTextWidth={(w) => setLayout({ width: w })} onExport={() => void run('Saving note…', async () => { const p = await exportNote(note.id); if (p) say(`Saved ${p}`); })} />
            </>
          )}
          {note && note.deleted && (
            <div className="empty">
              <p>“{note.title || 'Untitled'}” is in the Trash.</p>
              <button onClick={() => void run('Restoring…', () => store.updateNote(note.id, { deleted: false }))}>Restore note</button>
            </div>
          )}
          {!note && <div className="empty"><p>Select a note, or create a new one.</p>{layout.focus && <button onClick={() => setLayout({ focus: false })}>Exit full page</button>}{!layout.focus && (!layout.folders || !layout.list) && <button onClick={() => setLayout({ folders: true, list: true })}>Show folders and notes</button>}</div>}
        </section>
      </main>
      <PromptHost />
      {showSettings && <Settings onClose={() => setShowSettings(false)} onError={fail} />}
      {showImport && <ImportDialog onClose={() => setShowImport(false)} onError={fail} onDone={(m) => say(m)} targetFolder={currentFolder} />}
    </div>
  );
}
