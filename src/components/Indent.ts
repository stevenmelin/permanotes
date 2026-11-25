import { Extension, type Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';

const LIST = new Set(['bulletList', 'orderedList', 'taskList']);
const ITEM = new Set(['listItem', 'taskItem']);

// Tab / Shift+Tab indent and un-indent like OneNote.
// - inside a list: normal nesting; if the line is the first of a list that sits right under another list,
//   the whole list moves under the last item above it
// - plain lines: become indented (no bullet); Shift+Tab brings them back
// - tables keep Tab for moving between cells
type Ed = Editor;

/** Indent the selected lines one level (same as Tab). Returns false if nothing could move. */
export function indentMore(editor: Ed): boolean {
  const { state } = editor;
  const { $from } = state.selection;
  let d = $from.depth;
  while (d > 0 && !ITEM.has($from.node(d).type.name)) d--;
  if (d > 0) {
    const itemType = $from.node(d).type.name;
    if (editor.can().sinkListItem(itemType)) return editor.commands.sinkListItem(itemType);
    // first item of its list: tuck the whole list under the previous list's last item
    const listDepth = d - 1;
    const list = $from.node(listDepth);
    const parent = $from.node(listDepth - 1);
    const idx = $from.index(listDepth - 1);
    const prev: PMNode | null = idx > 0 ? parent.child(idx - 1) : null;
    if (prev && LIST.has(prev.type.name) && prev.lastChild && ITEM.has(prev.lastChild.type.name)) {
      const listPos = $from.before(listDepth);
      const insertAt = listPos - 2; // end of the previous list's last item (before </li></ul>)
      const tr = state.tr;
      tr.delete(listPos, listPos + list.nodeSize);
      tr.insert(insertAt, list);
      tr.setSelection(TextSelection.create(tr.doc, insertAt + (state.selection.from - listPos), insertAt + (state.selection.to - listPos)));
      editor.view.dispatch(tr.scrollIntoView());
      return true;
    }
    return false;
  }
  // plain lines (also inside table cells): indent without a bullet
  if (editor.isActive('paragraph')) return editor.chain().toggleBulletList().updateAttributes('bulletList', { bullet: 'none' }).run();
  return false;
}

/** Bring the selected lines back one level (same as Shift+Tab). */
export function indentLess(editor: Ed): boolean {
  for (const t of ['listItem', 'taskItem']) if (editor.isActive(t) && editor.can().liftListItem(t)) return editor.commands.liftListItem(t);
  return false;
}

export const Indent = Extension.create({
  name: 'pnIndent',
  addKeyboardShortcuts() {
    return {
      // tables keep Tab for moving between cells; otherwise Tab never leaves the note
      Tab: ({ editor }) => { if (editor.isActive('table')) return false; indentMore(editor); return true; },
      'Shift-Tab': ({ editor }) => { if (editor.isActive('table')) return false; indentLess(editor); return true; },
    };
  },
});
