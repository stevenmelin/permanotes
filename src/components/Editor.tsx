import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor as TEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import { BulletList, TaskItem, TaskList } from '@tiptap/extension-list';
import { TextStyleKit } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import { Placeholder } from '@tiptap/extensions';
import { AttachmentNode } from './AttachmentNode';
import { askText } from './Prompt';
import { rememberUrl, resolveHtml, unresolveHtml } from '../lib/attachments';
import { addAttachment, updateNote } from '../lib/store';
import type { Note } from '../lib/types';
import { pickFiles } from '../lib/platform';
import { errText } from '../lib/util';

// Bullet lists remember their marker (disc, circle, square, dash, none) like OneNote.
export const BULLET_STYLES = ['disc', 'circle', 'square', 'dash', 'none'] as const;
const StyledBulletList = BulletList.extend({
  addAttributes() {
    return {
      bullet: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-bullet'),
        renderHTML: (a: { bullet?: string | null }) => (a.bullet ? { 'data-bullet': a.bullet } : {}),
      },
    };
  },
});

export const editorExtensions = [
  StarterKit.configure({ link: { openOnClick: true, autolink: true }, bulletList: false }),
  StyledBulletList,
  TextStyleKit,
  Highlight.configure({ multicolor: true }),
  TableKit.configure({ table: { resizable: true } }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Image.configure({ allowBase64: false }),
  AttachmentNode,
  Placeholder.configure({ placeholder: 'Start writing…' }),
];

const TEXT_COLORS: [string, string][] = [['Automatic', 'none'], ['Red', '#FA0000'], ['Orange', '#E36C0A'], ['Green', '#00A933'], ['Blue', '#0070C0'], ['Purple', '#7030A0'], ['Gray', '#747474']];
const HIGHLIGHTS: [string, string][] = [['No highlight', 'none'], ['Yellow', 'yellow'], ['Green', 'lime'], ['Turquoise', 'aqua'], ['Pink', 'magenta'], ['Orange', 'orange']];

async function insertFiles(editor: TEditor, noteId: string, files: File[]) {
  for (const f of files) {
    const a = await addAttachment(f, f.name, f.type || 'application/octet-stream', noteId);
    if (f.type.startsWith('image/') && !/emf|wmf|tiff/.test(f.type)) {
      editor.chain().focus().setImage({ src: rememberUrl(a.id, f) }).run();
    } else {
      editor.chain().focus().insertContent({ type: 'pnAttachment', attrs: { id: a.id, name: a.name, mime: a.mime } }).run();
    }
  }
}

export function Editor({ note, onError, onExport, showToolbar, textWidth, onTextWidth }: {
  note: Note; onError: (m: string) => void; onExport: () => void;
  showToolbar: boolean; textWidth: number | null; onTextWidth: (w: number | null) => void;
}) {
  const [title, setTitle] = useState(note.title);
  const [tags, setTags] = useState(note.tags.join(', '));
  const [loadIssues, setLoadIssues] = useState<string[]>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHtml = useRef<string>(note.html);
  const noteId = useRef(note.id);
  const ready = useRef(false);

  const editor = useEditor({
    extensions: editorExtensions,
    content: '',
    editorProps: {
      handlePaste: (_v, ev) => {
        const files = [...(ev.clipboardData?.files ?? [])];
        if (!files.length || !editor) return false;
        void insertFiles(editor, noteId.current, files).catch((e) => onError(`Paste failed: ${errText(e)}`));
        return true;
      },
      handleDrop: (_v, ev) => {
        const files = [...((ev as DragEvent).dataTransfer?.files ?? [])];
        if (!files.length || !editor) return false;
        if (files.every((f) => f.name.toLowerCase().endsWith('.pn'))) return false; // let the app open .pn files
        ev.preventDefault();
        void insertFiles(editor, noteId.current, files).catch((e) => onError(`Drop failed: ${errText(e)}`));
        return true;
      },
    },
    onUpdate: () => { if (ready.current) scheduleSave(); },
  });

  const save = () => {
    if (!editor) return;
    try {
      const html = unresolveHtml(editor.getHTML());
      lastHtml.current = html;
      void updateNote(noteId.current, { html }).catch((e) => onError(`Saving failed: ${errText(e)}`));
    } catch (e) { onError(`Saving failed: ${errText(e)}`); }
  };
  const flush = () => {
    if (!saveTimer.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    save();
  };
  const scheduleSave = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { saveTimer.current = null; save(); }, 600);
  };

  // Load content when the note changes (or arrives from another device while not being edited).
  useEffect(() => {
    if (!editor) return;
    const switching = noteId.current !== note.id;
    if (switching) flush();
    if (!switching && ready.current && (note.html === lastHtml.current || saveTimer.current)) return;
    noteId.current = note.id;
    lastHtml.current = note.html;
    ready.current = false;
    let cancelled = false;
    void resolveHtml(note.html).then(({ html, failures }) => {
      if (cancelled) return;
      editor.commands.setContent(html, { emitUpdate: false });
      setLoadIssues(failures);
      ready.current = true;
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, note.id, note.html]);

  useEffect(() => { setTitle(note.title); setTags(note.tags.join(', ')); }, [note.id, note.title, note.tags]);
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!editor) return null;
  const b = (label: string, title: string, run: () => void, active = false) => (
    <button className={active ? 'tb on' : 'tb'} title={title} onMouseDown={(e) => { e.preventDefault(); run(); }}>{label}</button>
  );
  const c = () => editor.chain().focus();

  return (
    <div className="editor">
      <input className="title" value={title} placeholder="Title"
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => { if (title !== note.title) void updateNote(note.id, { title }).catch((e) => onError(errText(e))); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); editor.commands.focus('start'); } }} />
      <input className="tags" value={tags} placeholder="Tags (comma separated)"
        onChange={(e) => setTags(e.target.value)}
        onBlur={() => {
          const t = [...new Set(tags.split(',').map((x) => x.trim()).filter(Boolean))];
          if (t.join(',') !== note.tags.join(',')) void updateNote(note.id, { tags: t }).catch((e) => onError(errText(e)));
        }} />
      {showToolbar && <div className="toolbar">
        {b('B', 'Bold', () => c().toggleBold().run(), editor.isActive('bold'))}
        {b('I', 'Italic', () => c().toggleItalic().run(), editor.isActive('italic'))}
        {b('U', 'Underline', () => c().toggleUnderline().run(), editor.isActive('underline'))}
        {b('S', 'Strikethrough', () => c().toggleStrike().run(), editor.isActive('strike'))}
        {b('H1', 'Heading 1', () => c().toggleHeading({ level: 1 }).run(), editor.isActive('heading', { level: 1 }))}
        {b('H2', 'Heading 2', () => c().toggleHeading({ level: 2 }).run(), editor.isActive('heading', { level: 2 }))}
        {b('•', 'Bullet list', () => c().toggleBulletList().run(), editor.isActive('bulletList'))}
        {b('1.', 'Numbered list', () => c().toggleOrderedList().run(), editor.isActive('orderedList'))}
        {b('☑', 'Checklist', () => c().toggleTaskList().run(), editor.isActive('taskList'))}
        {editor.isActive('bulletList') && (
          <select className="tbsel" title="Bullet style" value={(editor.getAttributes('bulletList').bullet as string) ?? 'disc'}
            onChange={(e) => c().updateAttributes('bulletList', { bullet: e.target.value === 'disc' ? null : e.target.value }).run()}>
            <option value="disc">● Bullet</option><option value="circle">○ Circle</option><option value="square">▪ Square</option><option value="dash">– Dash</option><option value="none">(no bullet)</option>
          </select>
        )}
        {editor.isActive('orderedList') && (
          <select className="tbsel" title="Numbering style" value={(editor.getAttributes('orderedList').type as string) ?? '1'}
            onChange={(e) => c().updateAttributes('orderedList', { type: e.target.value === '1' ? null : e.target.value }).run()}>
            <option value="1">1, 2, 3</option><option value="a">a, b, c</option><option value="i">i, ii, iii</option><option value="A">A, B, C</option><option value="I">I, II, III</option>
          </select>
        )}
        <select className="tbsel" title="Text color" value="" onChange={(e) => { const v = e.target.value; if (v === 'none') c().unsetColor().run(); else if (v) c().setColor(v).run(); }}>
          <option value="">A Color</option>
          {TEXT_COLORS.map(([n, v]) => <option key={v} value={v} style={{ color: v === 'none' ? undefined : v }}>{n}</option>)}
        </select>
        <select className="tbsel" title="Highlight" value="" onChange={(e) => { const v = e.target.value; if (v === 'none') c().unsetHighlight().run(); else if (v) c().setHighlight({ color: v }).run(); }}>
          <option value="">🖍 Highlight</option>
          {HIGHLIGHTS.map(([n, v]) => <option key={v} value={v}>{n}</option>)}
        </select>
        {b('▦', 'Insert table', () => c().insertTable({ rows: 3, cols: 3, withHeaderRow: false }).run())}
        {editor.isActive('table') && <>
          {b('+Row', 'Add row', () => c().addRowAfter().run())}
          {b('+Col', 'Add column', () => c().addColumnAfter().run())}
          {b('−Row', 'Delete row', () => c().deleteRow().run())}
          {b('−Col', 'Delete column', () => c().deleteColumn().run())}
          {b('✕▦', 'Delete table', () => c().deleteTable().run())}
        </>}
        {b('🔗', 'Link', () => {
          const prev = editor.getAttributes('link').href as string | undefined;
          void askText('Link address (leave empty to remove the link)', prev ?? 'https://').then((url) => {
            if (url === null) return;
            if (url === '') c().unsetLink().run(); else c().extendMarkRange('link').setLink({ href: url }).run();
          });
        }, editor.isActive('link'))}
        {b('🖼', 'Insert image', () => { void pickFiles('image/*', true).then((f) => insertFiles(editor, note.id, f)).catch((e) => onError(errText(e))); })}
        {b('📎', 'Attach file or audio', () => { void pickFiles('*/*', true).then((f) => insertFiles(editor, note.id, f)).catch((e) => onError(errText(e))); })}
        {b('↶', 'Undo', () => c().undo().run())}
        {b('↷', 'Redo', () => c().redo().run())}
        <span className="spacer" />
        <button className="tb" title="Save this note as a .pn file" onClick={onExport}>Save .pn</button>
      </div>}
      {loadIssues.length > 0 && <div className="warn">Some attachments couldn't be loaded: {loadIssues.join(' · ')}</div>}
      <div className="content">
        <div className="page" style={textWidth ? { width: textWidth } : undefined}>
          <EditorContent editor={editor} />
          <div className="width-handle" title="Drag to make the text narrower or wider. Double-click to fill the window."
            onDoubleClick={() => onTextWidth(null)}
            onPointerDown={(e) => {
              e.preventDefault();
              const page = (e.currentTarget.parentElement as HTMLElement);
              const left = page.getBoundingClientRect().left;
              const max = (page.parentElement as HTMLElement).clientWidth - 8;
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              const move = (ev: PointerEvent) => onTextWidth(Math.max(220, Math.min(max, Math.round(ev.clientX - left))));
              const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
              window.addEventListener('pointermove', move);
              window.addEventListener('pointerup', up);
            }} />
        </div>
      </div>
    </div>
  );
}
