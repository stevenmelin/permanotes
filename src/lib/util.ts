export const uid = (): string => crypto.randomUUID();
export const now = (): string => new Date().toISOString();

export const ATT_PREFIX = 'pn-att:';
const INLINE_RE = /pn-att:([0-9a-fA-F-]{36})/g; // images: src="pn-att:<id>"
const ANY_RE = /(?:pn-att:|data-pn-att=")([0-9a-fA-F-]{36})/g; // images + file/audio blocks

export function inlineAttachmentIdsIn(html: string): string[] {
  return [...new Set([...html.matchAll(INLINE_RE)].map((m) => m[1].toLowerCase()))];
}

export function attachmentIdsIn(html: string): string[] {
  return [...new Set([...html.matchAll(ANY_RE)].map((m) => m[1].toLowerCase()))];
}

export function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
}

export function safeFileName(name: string): string {
  const c = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().replace(/\.+$/, '');
  return (c || 'Untitled').slice(0, 80);
}

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp',
  webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff', emf: 'image/emf', wmf: 'image/wmf', svg: 'image/svg+xml',
  pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', html: 'text/html', htm: 'text/html',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac',
  ogg: 'audio/ogg', wma: 'audio/x-ms-wma', flac: 'audio/flac', aif: 'audio/aiff', aiff: 'audio/aiff',
  mp4: 'video/mp4', mov: 'video/quicktime', wmv: 'video/x-ms-wmv', avi: 'video/x-msvideo', mid: 'audio/midi', midi: 'audio/midi',
};

export function mimeFor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return MIME[ext] ?? 'application/octet-stream';
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function errText(e: unknown): string {
  if (e instanceof Error) {
    const head = `${e.name}: ${e.message}`;
    return e.stack && e.stack.includes(e.message) ? e.stack : `${head}${e.stack ? '\n' + e.stack : ''}`;
  }
  if (typeof e === 'object' && e) {
    try { return JSON.stringify(e); } catch { /* fall through */ }
  }
  return String(e);
}
