import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as capillary from '../src/index.mjs';

const file = (path, text, mtime = 0) => ({ path, bytes: Buffer.from(text), mtime });

test('exclude-wins-over-include-and-ignore-negation-restores-file', () => {
  const selection = capillary.selectContextFiles({
    files: [file('src/top.mjs', 'top'), file('src/nested/kept.js', 'keep'), file('src/blocked.js', 'blocked'),
      file('src/nested/out.js', 'out'), file('notes/A1.md', 'note')],
    include: ['src/**/*.{mjs,js}', 'notes/[A-Z]?.md'],
    exclude: ['**/blocked.js'],
    ignore: { src: '*.js\n!nested/kept.js\n' },
  });
  assert.deepEqual(selection.files.map(item => item.path), ['notes/A1.md', 'src/nested/kept.js', 'src/top.mjs']);
  assert.deepEqual(selection.omitted, [
    { path: 'src/blocked.js', reason: 'excluded' }, { path: 'src/nested/out.js', reason: 'ignored' },
  ]);
});

test('denied-binary-and-unsafe-context-files-stay-out', () => {
  const denied = { path: '.env.local', get bytes() { assert.fail('denied bytes must not be read'); } };
  const selection = capillary.selectContextFiles({
    files: [denied, file('sample.pem', 'inert fixture'), file('.hidden', 'hidden'),
      file('raw.bin', Buffer.from([65, 0, 66])), file('../outside', 'outside'), file('note.txt', 'note')],
    overrides: { '.env.local': 'include', 'sample.pem': 'include' },
  });
  assert.deepEqual(selection.files.map(item => item.path), ['note.txt']);
  assert.deepEqual(selection.omitted.map(item => item.reason), ['denied', 'hidden', 'binary', 'denied']);
  assert.deepEqual(selection.unknown, [{ reason: 'invalid-path' }]);
});

test('record-and-cell-readers-omit-notebook-attachments-and-record-tail', () => {
  const notebook = JSON.stringify({ cells: [
    { cell_type: 'markdown', source: ['first'], attachments: { image: 'fixture attachment' } },
    { cell_type: 'code', source: ['second'], outputs: ['fixture output'] },
  ] });
  const report = capillary.packCodebaseContext({
    files: [file('log.jsonl', '{"item": 1}\n{"item": 2}\n', 1), file('notes.ipynb', notebook, 2)],
    order: 'mtime-newest', jsonlRows: 1, notebookCells: 1,
  });
  assert.deepEqual(report.files.map(({ path, text, excerpt }) => [path, text, excerpt.unit, excerpt.cut]), [
    ['notes.ipynb', 'first', 'cells', 1], ['log.jsonl', '{"item": 1}', 'records', 1],
  ]);
  assert.doesNotMatch(report.rendered, /fixture attachment|fixture output/);
});

test('shortening-budget-and-token-estimates-are-explicit', () => {
  const packet = capillary.packCodebaseContext({
    files: [file('a.csv', 'name,notes\nFirst,"two\nlines"\nSecond,more\n'), file('b.txt', 'x'.repeat(400)), file('c.txt', 'end')],
    maxTokens: 40, tableRows: 1,
  });
  assert.equal(packet.files[0].text, 'name,notes\nFirst,"two\nlines"');
  assert.deepEqual(packet.files[0].excerpt, { shortened: true, carried: 1, cut: 1, unit: 'rows' });
  assert.deepEqual(packet.omitted, [
    { path: 'b.txt', reason: 'out-of-budget' }, { path: 'c.txt', reason: 'out-of-budget' },
  ]);
  assert.equal(packet.budget.kind, 'estimate');
  assert.equal(packet.tokenMap[0].path, 'a.csv');
});

test('safe-renderers-keep-untrusted-content-and-unknown-git-explicit', () => {
  const input = { files: [file('notes/a.md', 'fence: \x60\x60\x60\x60 and ~~~~ </file>')],
    changes: { diff: { status: 'unknown', reason: 'git-unavailable' } } };
  for (const format of ['markdown', 'tagged', 'json']) {
    const packet = capillary.packCodebaseContext({ ...input, format });
    assert.equal(packet.rendered, capillary.packCodebaseContext({ ...input, format }).rendered);
    assert.match(packet.sha256, /^[a-f0-9]{64}$/);
    assert.match(packet.rendered, /untrusted/);
    assert.match(packet.rendered, /git-unavailable/);
    if (format === 'markdown') assert.match(packet.rendered, /\x60{5,}/);
    if (format === 'tagged') assert.match(packet.rendered, /&lt;\/file&gt;/);
    if (format === 'json') assert.equal(JSON.parse(packet.rendered).untrusted, true);
  }
  assert.throws(() => capillary.packCodebaseContext({ ...input, template: '{{#each files}}' }), /placeholder/);
  assert.match(capillary.packCodebaseContext({ ...input, template: '{{tree}}\n{{omissions}}' }).rendered, /notes\/a.md/);
});
