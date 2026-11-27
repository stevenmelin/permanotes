import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

// Fonts that only exist to draw emoji. OneNote tagged every emoji with one of these, and text typed
// after an emoji inherited it (different/larger font). Emoji display fine without them, so they are removed.
export const EMOJI_FONT_RE = /emoji|segoe ui symbol|noto color|twemoji/i;

export const EmojiFontCleanup = Extension.create({
  name: 'pnEmojiFontCleanup',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('pnEmojiFontCleanup'),
      appendTransaction: (trs, _old, state) => {
        if (!trs.some((t) => t.docChanged)) return null;
        const type = state.schema.marks.textStyle;
        if (!type) return null;
        const tr = state.tr;
        state.doc.descendants((node, pos) => {
          if (!node.isText) return;
          for (const m of node.marks) {
            if (m.type !== type || !EMOJI_FONT_RE.test(String(m.attrs.fontFamily ?? ''))) continue;
            const attrs = { ...m.attrs, fontFamily: null };
            tr.removeMark(pos, pos + node.nodeSize, m);
            if (Object.values(attrs).some((v) => v != null && v !== '')) tr.addMark(pos, pos + node.nodeSize, type.create(attrs));
          }
        });
        // also stop the cursor from carrying the emoji font into what you type next
        const stored = state.storedMarks?.find((m) => m.type === type && EMOJI_FONT_RE.test(String(m.attrs.fontFamily ?? '')));
        if (stored) tr.setStoredMarks((state.storedMarks ?? []).filter((m) => m !== stored));
        return tr.docChanged || stored ? tr.setMeta('addToHistory', false) : null;
      },
    })];
  },
});
