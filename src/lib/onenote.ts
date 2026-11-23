// Converts one OneNote page XML (2013 schema, from OneNote's GetPageContent with binary data) to PermaNotes HTML.
// Pure: no browser or app imports, so it runs in tests too.

export interface ImgOut { id: string; kind: 'image'; mime: string; name: string; base64: string }
export interface FileOut { id: string; kind: 'file'; mime: string; name: string; path: string }
export interface PageOut {
  title: string;
  created: string | null;
  modified: string | null;
  level: number;
  html: string;
  attachments: (ImgOut | FileOut)[];
  warnings: string[];
}
export interface ParserLike { parseFromString(s: string, type: string): Document }

interface Ctx {
  quick: Map<string, string>;
  tagDefs: Map<string, { name: string; symbol: string }>;
  atts: (ImgOut | FileOut)[];
  warnings: string[];
  newId: () => string;
  parser: ParserLike;
  mimeFor: (name: string) => string;
  pageTitle: string;
}

// Some XML parsers report 'one:Page' as the localName; normalise to 'Page'.
export const ln = (el: Element) => (el.localName ?? el.nodeName).replace(/^.*:/, '');
const kids = (el: Element, name?: string): Element[] => {
  const out: Element[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (!name || ln(n as Element) === name)) out.push(n as Element);
  }
  return out;
};
const kid = (el: Element, name: string) => kids(el, name)[0];
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const IMG_OK = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg']);
const IMG_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml', emf: 'image/emf', wmf: 'image/wmf', tif: 'image/tiff', tiff: 'image/tiff' };

export function convertPage(xml: string, parser: ParserLike, newId: () => string, mimeFor: (n: string) => string): PageOut {
  const doc = parser.parseFromString(xml.replace(/^﻿/, ''), 'application/xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) throw new Error(`Page XML could not be read: ${err.textContent?.slice(0, 200)}`);
  const page = doc.documentElement;
  if (!page || ln(page) !== 'Page') throw new Error(`Expected a OneNote <Page>, found <${page ? ln(page) : 'nothing'}>`);

  const ctx: Ctx = { quick: new Map(), tagDefs: new Map(), atts: [], warnings: [], newId, parser, mimeFor, pageTitle: page.getAttribute('name') ?? '' };
  for (const q of kids(page, 'QuickStyleDef')) ctx.quick.set(q.getAttribute('index') ?? '', q.getAttribute('name') ?? '');
  for (const t of kids(page, 'TagDef')) ctx.tagDefs.set(t.getAttribute('index') ?? '', { name: t.getAttribute('name') ?? '', symbol: t.getAttribute('symbol') ?? '' });

  let title = page.getAttribute('name') ?? '';
  const titleEl = kid(page, 'Title');
  if (!title && titleEl) title = plainText(titleEl);

  const blocks: string[] = [];
  for (const c of kids(page)) {
    switch (ln(c)) {
      case 'Outline': for (const oec of kids(c, 'OEChildren')) blocks.push(convertOEChildren(oec, ctx, false)); break;
      case 'Image': blocks.push(image(c, ctx)); break;
      case 'InsertedFile': case 'MediaFile': blocks.push(file(c, ctx)); break;
      case 'InkDrawing': case 'InkParagraph': case 'InkWord':
        ctx.warnings.push('handwriting/drawing not imported');
        blocks.push('<p><em>[Handwriting or drawing from OneNote was not imported]</em></p>');
        break;
      default: break;
    }
  }
  let html = blocks.filter(Boolean).join('');
  if (!html) html = '<p></p>';
  return {
    title: title.trim() || 'Untitled',
    created: page.getAttribute('dateTime'),
    modified: page.getAttribute('lastModifiedTime'),
    level: Number(page.getAttribute('pageLevel') ?? 1) || 1,
    html,
    attachments: ctx.atts,
    warnings: [...new Set(ctx.warnings)],
  };
}

function plainText(el: Element): string {
  return kids(el).map((c) => (ln(c) === 'T' ? stripTags(c.textContent ?? '') : plainText(c))).join(' ').trim();
}
const stripTags = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

type Kind = 'task' | 'ul' | 'ol' | 'plain';

function oeKind(oe: Element, ctx: Ctx): { kind: Kind; checked: boolean; label: string } {
  let label = '';
  let task: { checked: boolean } | null = null;
  for (const t of kids(oe, 'Tag')) {
    const def = ctx.tagDefs.get(t.getAttribute('index') ?? '');
    const name = def?.name ?? '';
    if (/to ?do|task|check|discuss|call back|schedule/i.test(name) || def?.symbol === '3') {
      task = { checked: t.getAttribute('completed') === 'true' };
    } else if (name) {
      label += `[${name}] `;
    }
  }
  if (task) return { kind: 'task', checked: task.checked, label };
  const list = kid(oe, 'List');
  if (list) return { kind: kid(list, 'Number') ? 'ol' : 'ul', checked: false, label };
  return { kind: 'plain', checked: false, label };
}

function convertOEChildren(oec: Element, ctx: Ctx, nested: boolean): string {
  const oes = kids(oec, 'OE');
  let out = '';
  let i = 0;
  while (i < oes.length) {
    const k = oeKind(oes[i], ctx).kind;
    const group: Element[] = [];
    while (i < oes.length && oeKind(oes[i], ctx).kind === k) group.push(oes[i++]);
    if (k === 'plain' && !nested) {
      for (const oe of group) {
        out += oeBlocks(oe, ctx, oeKind(oe, ctx).label).join('');
        const sub = kid(oe, 'OEChildren');
        if (sub) out += convertOEChildren(sub, ctx, true);
      }
      continue;
    }
    const tag = k === 'ol' ? 'ol' : 'ul';
    const open = k === 'task' ? '<ul data-type="taskList">' : `<${tag}>`;
    out += open;
    for (const oe of group) {
      const info = oeKind(oe, ctx);
      const blocks = oeBlocks(oe, ctx, info.label);
      if (!blocks.length || !/^<p[ >]/.test(blocks[0])) blocks.unshift('<p></p>');
      const sub = kid(oe, 'OEChildren');
      const inner = blocks.join('') + (sub ? convertOEChildren(sub, ctx, true) : '');
      out += k === 'task' ? `<li data-type="taskItem" data-checked="${info.checked}">${inner}</li>` : `<li>${inner}</li>`;
    }
    out += `</${tag}>`;
  }
  return out;
}

function oeBlocks(oe: Element, ctx: Ctx, label: string): string[] {
  const out: string[] = [];
  const style = ctx.quick.get(oe.getAttribute('quickStyleIndex') ?? '') ?? 'p';
  for (const c of kids(oe)) {
    switch (ln(c)) {
      case 'T': {
        const inner = (label ? esc(label) : '') + richText(c.textContent ?? '', ctx);
        label = '';
        const h = /^h([1-6])$/.exec(style);
        if (h) out.push(`<h${h[1]}>${inner}</h${h[1]}>`);
        else if (style === 'code') out.push(`<pre><code>${stripTags(c.textContent ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code></pre>`);
        else out.push(`<p>${inner}</p>`);
        break;
      }
      case 'Table': out.push(table(c, ctx)); break;
      case 'Image': out.push(image(c, ctx)); break;
      case 'InsertedFile': case 'MediaFile': out.push(file(c, ctx)); break;
      case 'InkWord': case 'InkParagraph': case 'InkDrawing':
        ctx.warnings.push('handwriting/drawing not imported');
        out.push('<p><em>[Handwriting from OneNote was not imported]</em></p>');
        break;
      case 'OCRData': case 'Meta': case 'Tag': case 'List': case 'OEChildren': case 'MathML': break;
      default: break;
    }
  }
  if (label) out.unshift(`<p>${esc(label.trim())}</p>`);
  return out;
}

function richText(cdata: string, ctx: Ctx): string {
  if (!/[<&]/.test(cdata)) return esc(cdata);
  const d = ctx.parser.parseFromString(`<!doctype html><html><body><div id="pn">${cdata}</div></body></html>`, 'text/html');
  const root = d.getElementById('pn') ?? d.body;
  return walk(root);
}

function walk(node: Node): string {
  let s = '';
  for (let n = node.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 3) { s += esc((n.textContent ?? '').replace(/ /g, ' ')); continue; }
    if (n.nodeType !== 1) continue;
    const el = n as Element;
    const name = ln(el).toLowerCase();
    const inner = walk(el);
    if (name === 'br') { s += '<br>'; continue; }
    if (name === 'a') {
      const href = el.getAttribute('href') ?? '';
      s += /^(https?:|mailto:|onenote:|file:)/i.test(href) ? `<a href="${esc(href)}">${inner}</a>` : inner;
      continue;
    }
    let wrapped = inner;
    const st = (el.getAttribute('style') ?? '').toLowerCase();
    if (name === 'b' || name === 'strong' || /font-weight:\s*(bold|[6-9]00)/.test(st)) wrapped = `<strong>${wrapped}</strong>`;
    if (name === 'i' || name === 'em' || /font-style:\s*italic/.test(st)) wrapped = `<em>${wrapped}</em>`;
    if (name === 'u' || /text-decoration:[^;]*underline/.test(st)) wrapped = `<u>${wrapped}</u>`;
    if (name === 's' || name === 'strike' || name === 'del' || /text-decoration:[^;]*line-through/.test(st)) wrapped = `<s>${wrapped}</s>`;
    s += wrapped;
  }
  return s;
}

function table(t: Element, ctx: Ctx): string {
  let html = '<table><tbody>';
  for (const row of kids(t, 'Row')) {
    html += '<tr>';
    for (const cell of kids(row, 'Cell')) {
      const oec = kid(cell, 'OEChildren');
      const inner = oec ? convertOEChildren(oec, ctx, false) : '';
      html += `<td>${inner || '<p></p>'}</td>`;
    }
    html += '</tr>';
  }
  return html + '</tbody></table>';
}

function image(img: Element, ctx: Ctx): string {
  const data = kid(img, 'Data');
  const fmt = (img.getAttribute('format') ?? 'png').toLowerCase();
  if (!data || !data.textContent?.trim()) {
    ctx.warnings.push('an image had no data in the export');
    return '<p><em>[Image missing from OneNote export]</em></p>';
  }
  const id = ctx.newId();
  const base64 = data.textContent.replace(/\s+/g, '');
  const name = `image-${id.slice(0, 8)}.${fmt}`;
  const mime = IMG_MIME[fmt] ?? 'application/octet-stream';
  ctx.atts.push({ id, kind: 'image', mime, name, base64 });
  if (!IMG_OK.has(fmt)) {
    ctx.warnings.push(`${fmt.toUpperCase()} image kept as an attachment (browsers can't display it)`);
    return `<div data-pn-att="${id}" data-name="${esc(name)}" data-mime="${esc(mime)}"></div>`;
  }
  return `<img src="pn-att:${id}" alt="">`;
}

function file(f: Element, ctx: Ctx): string {
  const name = f.getAttribute('preferredName') ?? f.getAttribute('pathSource')?.split(/[\\/]/).pop() ?? 'attachment';
  const path = f.getAttribute('exportedFile');
  if (!path) {
    ctx.warnings.push(`attachment "${name}" was not in the export`);
    return `<p><em>[Missing attachment: ${esc(name)}]</em></p>`;
  }
  const id = ctx.newId();
  const mime = ctx.mimeFor(name);
  ctx.atts.push({ id, kind: 'file', mime, name, path });
  return `<div data-pn-att="${id}" data-name="${esc(name)}" data-mime="${esc(mime)}"></div>`;
}
