import { Node, mergeAttributes } from '@tiptap/core';
import { getAttachmentBlob, getAttachmentUrl } from '../lib/attachments';
import { openAttachmentBlob, saveBytes } from '../lib/platform';
import { state } from '../lib/store';
import { formatBytes } from '../lib/util';

// A file / audio / video attachment block. Stored in HTML as <div data-pn-att="<id>" data-name=".." data-mime="..">
export const AttachmentNode = Node.create({
  name: 'pnAttachment',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      id: { default: null, parseHTML: (el) => el.getAttribute('data-pn-att'), renderHTML: (a) => ({ 'data-pn-att': a.id }) },
      name: { default: 'file', parseHTML: (el) => el.getAttribute('data-name'), renderHTML: (a) => ({ 'data-name': a.name }) },
      mime: { default: '', parseHTML: (el) => el.getAttribute('data-mime'), renderHTML: (a) => ({ 'data-mime': a.mime }) },
    };
  },
  parseHTML() { return [{ tag: 'div[data-pn-att]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { class: 'pn-att' })]; },
  addNodeView() {
    return ({ node }) => {
      const id = node.attrs.id as string;
      const name = node.attrs.name as string;
      const mime = (node.attrs.mime as string) || '';
      const dom = document.createElement('div');
      dom.className = 'pn-att';
      dom.contentEditable = 'false';
      const row = document.createElement('div');
      row.className = 'pn-att-row';
      const icon = mime.startsWith('audio/') ? '🎵' : mime.startsWith('video/') ? '🎬' : mime === 'application/pdf' ? '📕' : mime.startsWith('image/') ? '🖼️' : '📎';
      const size = state.attachments.get(id)?.size;
      row.innerHTML = `<span class="pn-att-icon">${icon}</span><span class="pn-att-name"></span><span class="pn-att-size">${size ? formatBytes(size) : ''}</span>`;
      (row.querySelector('.pn-att-name') as HTMLElement).textContent = name;
      const open = document.createElement('button');
      open.textContent = 'Open';
      const save = document.createElement('button');
      save.textContent = 'Save…';
      const err = document.createElement('div');
      err.className = 'pn-att-err';
      const fail = (e: unknown) => { err.textContent = `Could not load "${name}": ${e instanceof Error ? e.message : String(e)}`; };
      open.onclick = async (ev) => { ev.preventDefault(); try { await openAttachmentBlob(name, await getAttachmentBlob(id)); } catch (e) { fail(e); } };
      save.onclick = async (ev) => {
        ev.preventDefault();
        try { await saveBytes(name, new Uint8Array(await (await getAttachmentBlob(id)).arrayBuffer()), mime); } catch (e) { fail(e); }
      };
      row.append(open, save);
      dom.append(row);
      if (mime.startsWith('audio/') || mime.startsWith('video/')) {
        const player = document.createElement(mime.startsWith('audio/') ? 'audio' : 'video') as HTMLMediaElement;
        player.controls = true;
        player.preload = 'none';
        player.className = 'pn-att-player';
        const load = document.createElement('button');
        load.textContent = '▶ Load player';
        load.onclick = async (ev) => {
          ev.preventDefault();
          try { player.src = await getAttachmentUrl(id); load.replaceWith(player); void player.play().catch(() => {}); } catch (e) { fail(e); }
        };
        dom.append(load);
      }
      dom.append(err);
      return { dom };
    };
  },
});
