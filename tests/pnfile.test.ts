import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packPn, unpackPn } from '../src/lib/pnfile.ts';
import type { PnBundle } from '../src/lib/types.ts';

test('.pn round-trips notes, folders and attachment bytes', async () => {
  const t = '2026-01-01T00:00:00.000Z';
  const bundle: PnBundle = {
    format: 'permanotes', version: 1, kind: 'library', exported_at: t, app_version: 'test',
    folders: [{ id: 'f1', parent_id: null, name: 'Mixes', sort: 0, updated_at: t, deleted: false, dirty: true }],
    notes: [{ id: 'n1', folder_id: 'f1', title: 'A', html: '<p>hi</p><img src="pn-att:a1">', tags: ['x'], sort: 0, created_at: t, updated_at: t, deleted: false, dirty: true, synced_at: 'zzz' }],
    attachments: [{ id: 'a1', note_id: 'n1', name: 'p.png', mime: 'image/png', size: 3, created_at: t, updated_at: t, deleted: false, has_blob: true }],
  };
  const bytes = await packPn(bundle, async () => new Uint8Array([1, 2, 3]));
  const { bundle: b, files } = await unpackPn(bytes);
  assert.equal(b.kind, 'library');
  assert.equal(b.notes[0].html, bundle.notes[0].html);
  assert.equal(b.folders[0].name, 'Mixes');
  assert.equal((b.notes[0] as { dirty?: boolean }).dirty, undefined, 'local sync flags are not written to files');
  assert.deepEqual([...files.get('a1')!], [1, 2, 3]);
});

test('non-.pn data fails with a clear message', async () => {
  await assert.rejects(unpackPn(new Uint8Array([1, 2, 3, 4])), /not a valid \.pn file/);
});
