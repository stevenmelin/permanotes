import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor as TEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import Image from '@tiptap/extension-image';
import { Placeholder } from '@tiptap/extensions';
import { AttachmentNode } from './AttachmentNode';
import { rememberUrl, resolveHtml, unresolveHtml } from '../lib/attachments';
import { addAttachment, updateNote } from '../lib/store';
import type { Note } from '../lib/types';
import { pickFiles } from '../lib/platform';
import { errText } from '../lib/util';

export const editorExtensions = [
  StarterKit.configure({ link: { openOnClick: true, autolink: true } }),
  TableKit.configure({ table: { resizable: true } }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Image.configure({ allowBase64: false }),
  AttachmentNode,
  Placeholder.configure({ placeholder: 'Start writing…' }),
];

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

export function Editor({ note, onError, onExport }: { note: Note; onError: (m: string) => void; onExport: () => void }) {
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
      <div className="toolbar">
        {b('B', 'Bold', () => c().toggleBold().run(), editor.isActive('bold'))}
        {b('I', 'Italic', () => c().toggleItalic().run(), editor.isActive('italic'))}
        {b('U', 'Underline', () => c().toggleUnderline().run(), editor.isActive('underline'))}
        {b('S', 'Strikethrough', () => c().toggleStrike().run(), editor.isActive('strike'))}
        {b('H1', 'Heading 1', () => c().toggleHeading({ level: 1 }).run(), editor.isActive('heading', { level: 1 }))}
        {b('H2', 'Heading 2', () => c().toggleHeading({ level: 2 }).run(), editor.isActive('heading', { level: 2 }))}
        {b('•', 'Bullet list', () => c().toggleBulletList().run(), editor.isActive('bulletList'))}
        {b('1.', 'Numbered list', () => c().toggleOrderedList().run(), editor.isActive('orderedList'))}
        {b('☑', 'Checklist', () => c().toggleTaskList().run(), editor.isActive('taskList'))}
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
          const url = window.prompt('Link address', prev ?? 'https://');
          if (url === null) return;
          if (url === '') c().unsetLink().run(); else c().extendMarkRange('link').setLink({ href: url }).run();
        }, editor.isActive('link'))}
        {b('🖼', 'Insert image', () => { void pickFiles('image/*', true).then((f) => insertFiles(editor, note.id, f)).catch((e) => onError(errText(e))); })}
        {b('📎', 'Attach file or audio', () => { void pickFiles('*/*', true).then((f) => insertFiles(editor, note.id, f)).catch((e) => onError(errText(e))); })}
        {b('↶', 'Undo', () => c().undo().run())}
        {b('↷', 'Redo', () => c().redo().run())}
        <span className="spacer" />
        <button className="tb" title="Save this note as a .pn file" onClick={onExport}>Save .pn</button>
      </div>
      {loadIssues.length > 0 && <div className="warn">Some attachments couldn't be loaded: {loadIssues.join(' · ')}</div>}
      <EditorContent editor={editor} className="content" />
    </div>
  );
}
