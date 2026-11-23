import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';

const LIST = new Set(['bulletList', 'orderedList', 'taskList']);
const ITEM = new Set(['listItem', 'taskItem']);

// Tab / Shift+Tab indent and un-indent like OneNote.
// - inside a list: normal nesting; if the line is the first of a list that sits right under another list,
//   the whole list moves under the last item above it
// - plain lines: become indented (no bullet); Shift+Tab brings them back
// - tables keep Tab for moving between cells
export const Indent = Extension.create({
  name: 'pnIndent',
  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        if (editor.isActive('table')) return false;
        const { state } = editor;
        const { $from } = state.selection;
        // find innermost list item
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
            const offset = state.selection.from - listPos;
            const to = state.selection.to - listPos;
            tr.setSelection(TextSelection.create(tr.doc, insertAt + offset, insertAt + to));
            editor.view.dispatch(tr.scrollIntoView());
            return true;
          }
          return true; // nothing to indent under: keep focus in the note
        }
        // plain paragraphs: indent without a bullet
        if (editor.isActive('paragraph')) {
          return editor.chain().toggleBulletList().updateAttributes('bulletList', { bullet: 'none' }).run();
        }
        return true;
      },
      'Shift-Tab': ({ editor }) => {
        if (editor.isActive('table')) return false;
        for (const t of ['listItem', 'taskItem']) if (editor.isActive(t) && editor.can().liftListItem(t)) return editor.commands.liftListItem(t);
        return true;
      },
    };
  },
});
