import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from 'linkedom';
import { decideNote, normTime, sameTime, copyBase } from '../src/lib/conflict.ts';
import { diffLines, linesOf, summaryText, wordDiff } from '../src/lib/diff.ts';
import type { Note } from '../src/lib/types.ts';

const note = (p: Partial<Note>): Note => ({ id: 'n', folder_id: null, title: 'SCHEDULE', html: '<p>a</p>', tags: [], sort: 0, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-11-25T16:25:01.123Z', deleted: false, ...p });

test('database time format equals app time format (the 1.0.0-1.0.5 false-conflict bug)', () => {
  assert.ok(sameTime('2026-11-25T16:25:01.123Z', '2026-11-25T16:25:01.123+00:00'));
  assert.ok(sameTime('2026-11-25T16:25:01.123Z', '2026-11-25T16:25:01.123456+00:00'));
  assert.equal(normTime('2026-11-25T11:25:01.123-05:00'), '2026-11-25T16:25:01.123Z');
});

test('my own upload coming back is never a conflict, even while I keep typing', () => {
  // pushed V1 (synced_at = V1 in app format), kept typing -> V2 dirty; server echoes V1 in its format
  const local = note({ html: '<p>V2</p>', updated_at: '2026-11-25T16:25:05.000Z', dirty: true, synced_at: '2026-11-25T16:25:01.123Z' });
  const remote = note({ html: '<p>V1</p>', updated_at: '2026-11-25T16:25:01.123+00:00', synced_at: '2026-11-25T16:25:01.123+00:00' });
  assert.equal(decideNote(local, remote, false), 'skip');
  assert.equal(decideNote(note({ dirty: true, updated_at: '2026-11-25T16:25:01.123Z' }), note({ updated_at: '2026-11-25T16:25:01.123+00:00' }), false), 'take');
});

test('real edits on two devices become a conflict; identical content does not', () => {
  const local = note({ html: '<p>phone edit</p>', updated_at: '2026-11-25T16:30:00.000Z', dirty: true, synced_at: '2026-11-25T16:00:00.000Z' });
  const remote = note({ html: '<p>pc edit</p>', updated_at: '2026-11-25T16:29:00.000+00:00' });
  assert.equal(decideNote(local, remote, false), 'conflict');
  assert.equal(decideNote(local, { ...remote, html: '<p>phone edit</p>' }, false), 'take');
  assert.equal(decideNote(undefined, remote, false), 'take');
  assert.equal(decideNote({ ...local, dirty: false }, remote, false), 'take');
});

test('old copy titles are recognised', () => {
  assert.equal(copyBase('SCHEDULE (conflict copy)'), 'SCHEDULE');
  assert.equal(copyBase('SCHEDULE (this device)'), 'SCHEDULE');
  assert.equal(copyBase('SCHEDULE'), null);
});

test('side-by-side diff: changed words, added and removed lines, summary', () => {
  const p = new DOMParser() as never;
  const a = linesOf('<p>Mix live Violin and Flute</p><p>keep</p><ul><li><p>Final mixes</p></li></ul><p>old line</p>', p);
  const b = linesOf('<p>Mix live Violin and Cello</p><p>keep</p><ul><li><p>Final mixes</p></li><li><p>Cutdowns</p></li></ul>', p);
  const { rows, summary } = diffLines(a, b);
  assert.deepEqual([summary.changed, summary.added, summary.removed], [1, 1, 1]);
  assert.match(summaryText(summary), /1 line changed · 1 line only in the other version · 1 line only in the current note/);
  const ch = rows.find((r) => r.kind === 'changed');
  assert.ok(ch && ch.kind === 'changed' && ch.words.some((w) => w.op === 'del' && w.text === 'Flute') && ch.words.some((w) => w.op === 'ins' && w.text === 'Cello'));
  assert.deepEqual(wordDiff('a b c', 'a x c').filter((w) => w.op !== 'same').map((w) => w.op + w.text), ['delb', 'insx']);
});
