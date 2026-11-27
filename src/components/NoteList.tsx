import { useEffect, useMemo, useRef, useState } from 'react';
import { getScroll, restoreScroll, saveScroll } from '../lib/scrollmem';
import * as store from '../lib/store';
import type { Note } from '../lib/types';

export type SortMode = 'custom' | 'newest' | 'title';
export const DRAG_TYPE = 'application/x-permanotes-notes';

interface Props {
  notes: Note[]; // already filtered for the current view/search
  showFolder: boolean;
  trash: boolean;
  openId: string | null;
  selection: Set<string>;
  setSelection: (s: Set<string>) => void;
  onOpen: (id: string) => void;
  sortMode: SortMode;
  setSortMode: (m: SortMode) => void;
  snippet: (n: Note) => string;
  run: (label: string, fn: () => Promise<unknown>) => Promise<void>;
  onOpenNewTab: (id: string) => void;
  onOpenWindow?: (id: string, screenX: number, screenY: number) => void; // desktop only
  onDraggedOut?: (ids: string[]) => void; // desktop only: a drag ended (maybe outside the window)
  onAddToFolder: (ids: string[]) => void; // asks which folder
  onTrash: (ids: string[]) => void;
}

type Drop = { zone: 'pinned' | 'rest'; index: number } | null;

export function NoteList(p: Props) {
  const { pinned, rest } = useMemo(() => {
    const byCustom = (a: Note, b: Note) => a.sort - b.sort || store.folderPath(a.folder_id).localeCompare(store.folderPath(b.folder_id)) || a.title.localeCompare(b.title);
    const cmp = p.sortMode === 'newest' ? (a: Note, b: Note) => b.updated_at.localeCompare(a.updated_at)
      : p.sortMode === 'title' ? (a: Note, b: Note) => a.title.localeCompare(b.title, undefined, { numeric: true })
      : byCustom;
    if (p.trash) return { pinned: [] as Note[], rest: [...p.notes].sort(cmp) };
    return {
      pinned: p.notes.filter(store.isPinned).sort((a, b) => a.pinned! - b.pinned!),
      rest: p.notes.filter((n) => !store.isPinned(n)).sort(cmp),
    };
  }, [p.notes, p.sortMode, p.trash]);
  const ordered = useMemo(() => [...pinned, ...rest], [pinned, rest]);
  const anchor = useRef<string | null>(null);
  const [drop, setDrop] = useState<Drop>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; ids: string[] } | null>(null);
  const dragging = useRef<string[]>([]);
  const listEl = useRef<HTMLDivElement>(null);
  useEffect(() => { if (listEl.current) restoreScroll(listEl.current, getScroll('list')); }, []);

  const click = (e: React.MouseEvent, id: string) => {
    const multi = e.ctrlKey || e.metaKey;
    if (e.shiftKey && anchor.current) {
      const a = ordered.findIndex((n) => n.id === anchor.current);
      const b = ordered.findIndex((n) => n.id === id);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      p.setSelection(new Set(ordered.slice(lo, hi + 1).map((n) => n.id)));
      return;
    }
    if (multi) {
      const s = new Set(p.selection);
      if (s.has(id)) s.delete(id); else s.add(id);
      p.setSelection(s);
      anchor.current = id;
      return;
    }
    anchor.current = id;
    p.setSelection(new Set([id]));
    p.onOpen(id);
  };

  const selectedIds = ordered.filter((n) => p.selection.has(n.id)).map((n) => n.id);
  const anyPinned = selectedIds.some((id) => store.isPinned(store.state.notes.get(id)!));
  const anyUnpinned = selectedIds.some((id) => !store.isPinned(store.state.notes.get(id)!));

  const onDragStart = (e: React.DragEvent, id: string) => {
    const ids = p.selection.has(id) ? selectedIds : [id];
    if (!p.selection.has(id)) p.setSelection(new Set([id]));
    dragging.current = ids;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids));
    // no plain-text copy: on a Mac, Finder would accept it and make a text clipping instead of a note window
  };

  // Work out where the line goes from the mouse position over a row
  const onDragOverRow = (e: React.DragEvent, n: Note, zone: 'pinned' | 'rest', idx: number) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE) || p.trash) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    const d: Drop = { zone, index: idx + (after ? 1 : 0) };
    if (!drop || drop.zone !== d.zone || drop.index !== d.index) setDrop(d);
    void n;
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const d = drop;
    setDrop(null);
    const ids = dragging.current;
    dragging.current = [];
    if (!d || !ids.length) return;
    if (d.zone === 'pinned') {
      const before = pinned.slice(0, d.index).filter((n) => !ids.includes(n.id)).map((n) => n.id);
      const after = pinned.slice(d.index).filter((n) => !ids.includes(n.id)).map((n) => n.id);
      void p.run('Pinning…', async () => {
        const newly = ids.filter((id) => !store.isPinned(store.state.notes.get(id)!));
        if (newly.length) await store.updateNotes(newly.map((id) => ({ id, patch: { pinned: 0.5 } })));
        await store.renumberPins([...before, ...ids, ...after]);
      });
    } else {
      const without = rest.filter((n) => !ids.includes(n.id));
      const index = rest.slice(0, d.index).filter((n) => !ids.includes(n.id)).length;
      void p.run('Reordering…', async () => {
        // reordering the list means "use my order", so the list switches to Custom order
        if (p.sortMode !== 'custom') {
          // adopt what's on screen as the custom order, with the dragged notes at the drop point
          const order = [...without.slice(0, index).map((n) => n.id), ...ids, ...without.slice(index).map((n) => n.id)];
          await store.updateNotes(order.map((id, i) => ({ id, patch: ids.includes(id) ? { sort: i, pinned: null } : { sort: i } })));
          p.setSortMode('custom');
        } else {
          await store.placeNotes(ids, without, index, { pinned: null });
        }
        await store.renumberPins();
      });
    }
  };

  const line = <div className="drop-line" />;
  const row = (n: Note, zone: 'pinned' | 'rest', idx: number) => (
    <div key={n.id}>
      {drop && drop.zone === zone && drop.index === idx && line}
      <div className={`note-item${n.id === p.openId ? ' active' : ''}${p.selection.has(n.id) ? ' selected' : ''}`}
        draggable={!p.trash}
        onDragStart={(e) => onDragStart(e, n.id)}
        onDragEnd={() => {
          const ids = dragging.current;
          setDrop(null); dragging.current = [];
          // dropped outside the PermaNotes window: open the note(s) in their own window there
          if (p.onDraggedOut && ids.length) p.onDraggedOut(ids);
        }}
        onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
        onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); p.onOpenNewTab(n.id); } }}
        onContextMenu={(e) => {
          e.preventDefault();
          const ids = p.selection.has(n.id) ? selectedIds : [n.id];
          if (!p.selection.has(n.id)) p.setSelection(new Set([n.id]));
          setMenu({ x: Math.min(e.clientX, window.innerWidth - 240), y: Math.min(e.clientY, window.innerHeight - 300), ids });
        }}
        onDragOver={(e) => onDragOverRow(e, n, zone, idx)}
        onClick={(e) => click(e, n.id)}>
        <div className="note-title">
          {zone === 'pinned' && <span className="pin-badge" title="Pinned — drag to change the order">📌 #{idx + 1}</span>}
          {n.conflicts?.some((c) => !c.auto) && <span className="conflict-dot" title="Changed in two places — open to compare">⚠ </span>}
          {n.title || 'Untitled'}
        </div>
        <div className="note-snippet">{p.snippet(n)}</div>
        <div className="note-meta">{new Date(n.updated_at).toLocaleDateString()}{p.showFolder && n.folder_id ? ` · ${store.folderPath(n.folder_id)}` : ''}</div>
      </div>
      {drop && drop.zone === zone && drop.index === idx + 1 && idx === (zone === 'pinned' ? pinned.length : rest.length) - 1 && line}
    </div>
  );

  return (
    <>
      <div className="list-tools">
        <select value={p.sortMode} title="List order" onChange={(e) => p.setSortMode(e.target.value as SortMode)}>
          <option value="custom">Custom order (drag)</option>
          <option value="newest">Newest first</option>
          <option value="title">Title A–Z</option>
        </select>
        {!p.trash && selectedIds.length > 0 && (anyUnpinned
          ? <button title="Pin to the top of the list" onClick={() => void p.run('Pinning…', () => store.pinNotes(selectedIds, true))}>📌 Pin{selectedIds.length > 1 ? ` ${selectedIds.length}` : ''}</button>
          : anyPinned && <button title="Unpin" onClick={() => void p.run('Unpinning…', () => store.pinNotes(selectedIds, false))}>Unpin{selectedIds.length > 1 ? ` ${selectedIds.length}` : ''}</button>)}
        {selectedIds.length > 1 && <span className="small">{selectedIds.length} selected</span>}
      </div>
      {menu && (
        <div className="ctx-back" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }}>
          <div className="ctx-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
            {menu.ids.length > 1 && <div className="ctx-title">{menu.ids.length} notes</div>}
            {!p.trash && <>
              <button onClick={() => { setMenu(null); menu.ids.forEach((id) => p.onOpenNewTab(id)); }}>Open in new tab</button>
              {p.onOpenWindow && <button onClick={() => { setMenu(null); menu.ids.slice(0, 4).forEach((id) => p.onOpenWindow!(id, 0, 0)); }}>Open in new window</button>}
              <hr />
              <button onClick={() => { setMenu(null); p.onAddToFolder(menu.ids); }}>📁 Add to folder…</button>
              {menu.ids.some((id) => store.state.notes.get(id)?.folder_id) && <button onClick={() => { setMenu(null); void p.run('Removing from folder…', () => store.moveNotesToFolder(menu.ids, null)); }}>Remove from folder</button>}
              {menu.ids.some((id) => !store.isPinned(store.state.notes.get(id)!))
                ? <button onClick={() => { setMenu(null); void p.run('Pinning…', () => store.pinNotes(menu.ids, true)); }}>📌 Pin to top</button>
                : <button onClick={() => { setMenu(null); void p.run('Unpinning…', () => store.pinNotes(menu.ids, false)); }}>Unpin</button>}
              <hr />
              <button className="danger" onClick={() => { setMenu(null); p.onTrash(menu.ids); }}>Move to Trash</button>
            </>}
            {p.trash && <button onClick={() => { setMenu(null); void p.run('Restoring…', () => store.updateNotes(menu.ids.map((id) => ({ id, patch: { deleted: false } })))); }}>Restore</button>}
          </div>
        </div>
      )}
      <div className="list-items" ref={listEl} onScroll={(e) => saveScroll('list', (e.target as HTMLElement).scrollTop)} onDrop={onDrop} onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) e.preventDefault(); }}
        onDragLeave={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDrop(null); }}>
        {pinned.length > 0 && <div className="list-section">Pinned</div>}
        {pinned.map((n, i) => row(n, 'pinned', i))}
        {pinned.length > 0 && rest.length > 0 && <div className="list-section"
          onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); setDrop({ zone: 'rest', index: 0 }); } }}>Notes</div>}
        {rest.map((n, i) => row(n, 'rest', i))}
        {pinned.length === 0 && rest.length === 0 && <div className="hint">No notes here.</div>}
        {!p.trash && ordered.length > 0 && <div className="list-tail"
          onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); setDrop({ zone: 'rest', index: rest.length }); } }} />}
      </div>
    </>
  );
}
