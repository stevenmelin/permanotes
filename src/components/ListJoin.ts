import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { canJoin } from '@tiptap/pm/transform';
import { Fragment, type Node as PMNode } from '@tiptap/pm/model';

// Default: two lists of the same kind sitting right next to each other are one list, like OneNote,
// so numbering continues (1, 2, 3…) after you delete a line between them.
// "Split list here" marks the lower list as split (data-split) — it then stays separate and starts at 1.
// Lists with a different style (1/a/i, or ●/○/▪/–) or anything in between are always separate.

export const LIST_TYPES = ['orderedList', 'bulletList', 'taskList'];
const ITEM_TYPES = ['listItem', 'taskItem'];

/** Attribute shared by all list types: true = keep this list separate from the list above it */
export const splitAttribute = {
  split: {
    default: false,
    parseHTML: (el: HTMLElement) => el.getAttribute('data-split') === 'true',
    renderHTML: (a: { split?: boolean }) => (a.split ? { 'data-split': 'true' } : {}),
  },
};

const sameList = (a: PMNode, b: PMNode) => {
  if (a.type !== b.type || b.attrs.split) return false;
  switch (a.type.name) {
    case 'orderedList': return (a.attrs.type ?? null) === (b.attrs.type ?? null);
    case 'bulletList': return (a.attrs.bullet ?? null) === (b.attrs.bullet ?? null);
    case 'taskList': return true;
    default: return false;
  }
};

/** Where the cursor's (innermost) list and list item are */
function listAtCursor(editor: Editor) {
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if (ITEM_TYPES.includes($from.node(d).type.name) && LIST_TYPES.includes($from.node(d - 1).type.name)) {
      return { list: $from.node(d - 1), listPos: $from.before(d - 1), index: $from.index(d - 1), parent: $from.node(d - 2), parentIndex: $from.index(d - 2) };
    }
  }
  return null;
}

export function canSplitList(editor: Editor): boolean {
  const at = listAtCursor(editor);
  return !!at && (at.index > 0 || (!at.list.attrs.split && at.parentIndex > 0 && sameListType(at.parent.child(at.parentIndex - 1), at.list)));
}
const sameListType = (a: PMNode, b: PMNode) => sameList(a, b.type.create({ ...b.attrs, split: false }));

/** The line above this one in a split list can be re-joined */
export function canJoinListAbove(editor: Editor): boolean {
  const at = listAtCursor(editor);
  return !!at && !!at.list.attrs.split;
}

/** Start a new, separate list at the cursor's line (numbering restarts at 1). */
export function splitListHere(editor: Editor): boolean {
  const at = listAtCursor(editor);
  if (!at) return false;
  const { state } = editor;
  const tr = state.tr;
  if (at.index === 0) {
    tr.setNodeMarkup(at.listPos, undefined, { ...at.list.attrs, split: true, ...(at.list.type.name === 'orderedList' ? { start: 1 } : {}) });
  } else {
    const items: PMNode[] = [];
    at.list.forEach((c) => items.push(c));
    const top = at.list.type.create(at.list.attrs, Fragment.fromArray(items.slice(0, at.index)));
    const bottom = at.list.type.create({ ...at.list.attrs, split: true, ...(at.list.type.name === 'orderedList' ? { start: 1 } : {}) }, Fragment.fromArray(items.slice(at.index)));
    const { from, to } = state.selection;
    tr.replaceWith(at.listPos, at.listPos + at.list.nodeSize, [top, bottom]);
    // two extra list boundaries now sit before the cursor
    tr.setSelection(TextSelection.create(tr.doc, Math.min(from + 2, tr.doc.content.size), Math.min(to + 2, tr.doc.content.size)));
  }
  editor.view.dispatch(tr.setMeta('pnListSplit', true).scrollIntoView());
  return true;
}

/** Undo a split: this list joins the one above again (numbering continues). */
export function joinListAbove(editor: Editor): boolean {
  const at = listAtCursor(editor);
  if (!at || !at.list.attrs.split) return false;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(at.listPos, undefined, { ...at.list.attrs, split: false }));
  return true;
}

export const ListJoin = Extension.create({
  name: 'pnListJoin',
  addGlobalAttributes() {
    return [{ types: LIST_TYPES, attributes: splitAttribute }];
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('pnListJoin'),
      appendTransaction: (trs, _old, state) => {
        if (!trs.some((t) => t.docChanged)) return null;
        const joins: number[] = [];
        const scan = (node: PMNode, contentStart: number) => {
          let prev: PMNode | null = null;
          node.forEach((child, offset) => {
            if (prev && sameList(prev, child)) joins.push(contentStart + offset);
            prev = child;
            if (!child.isTextblock && !child.isLeaf) scan(child, contentStart + offset + 1);
          });
        };
        scan(state.doc, 0);
        if (!joins.length) return null;
        const tr = state.tr;
        for (const at of joins.sort((a, b) => b - a)) if (canJoin(tr.doc, at)) tr.join(at);
        return tr.docChanged ? tr : null;
      },
    })];
  },
});
