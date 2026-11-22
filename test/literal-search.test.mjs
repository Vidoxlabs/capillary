import test from 'node:test';
import assert from 'node:assert/strict';

import * as capillary from '../src/index.mjs';

const record = (id, text, recency) => ({
  ...capillary.recordSource({
    id, title: 'Source note', digest: 'a'.repeat(64), origin: 'text', originRef: 'notes',
    evidenceClass: 'model-proposal', confidence: 'model-unverified',
  }),
  text,
  recency,
});

test('literal search preserves provenance and recency while reporting match counts and snippet cuts', async () => {
  const records = [
    { ...record('more-matches', '  [Cat]\n[cat]   tail  ', 10), relevance: 99 },
    record('one-match', '[cat]', 0),
    record('no-literal-match', 'cat cat', 90),
  ];
  const result = await capillary.searchSources({ query: '[CAT]', records, snippetChars: 7 });
  assert.equal(result.ok, true);
  assert.equal(result.untrusted, true);
  assert.equal(result.count, 2);
  assert.deepEqual(result.hits.map(hit => ({
    sourceId: hit.sourceId, relevance: hit.relevance, recency: hit.recency,
    evidenceClass: hit.evidenceClass, confidence: hit.confidence,
    snippet: hit.snippet, shortened: hit.shortened, carried: hit.carried, cut: hit.cut,
  })), [
    {
      sourceId: 'more-matches', relevance: 2, recency: 10,
      evidenceClass: 'model-proposal', confidence: 'model-unverified',
      snippet: '[Cat] [', shortened: true, carried: 7, cut: 9,
    },
    {
      sourceId: 'one-match', relevance: 1, recency: 0,
      evidenceClass: 'model-proposal', confidence: 'model-unverified',
      snippet: '[cat]', shortened: false, carried: 5, cut: 0,
    },
  ]);
  assert.equal(result.hits[0].sourceDigest, records[0].digest);
});

test('a search with no literal hit succeeds with an untrusted empty list', async () => {
  const result = await capillary.searchSources({ query: 'missing', records: [record('source-1', 'other text', null)] });
  assert.deepEqual(result, { ok: true, untrusted: true, hits: [], count: 0 });
});

test('a snippet budget does not split a Unicode character', async () => {
  const result = await capillary.searchSources({
    query: 'note', records: [record('source-1', 'A💡 note', null)], snippetChars: 2,
  });
  const { snippet, shortened, carried, cut, recency } = result.hits[0];
  assert.deepEqual({ snippet, shortened, carried, cut, recency }, {
    snippet: 'A', shortened: true, carried: 1, cut: 7, recency: null,
  });
});

test('literal search refuses fused scores and missing recency without returning hits', async () => {
  const good = record('source-1', 'matches', 1);
  const fused = { ...record('source-2', 'other text', 5), score: 8 };
  const invalid = { ...good, recency: undefined };
  for (const [records, code] of [[[good, fused], 'fused-score'], [[invalid], 'invalid-search-record']]) {
    const result = await capillary.searchSources({ query: 'matches', records });
    assert.equal(result.ok, false);
    assert.equal(result.untrusted, true);
    assert.equal(result.error.code, code);
    assert.deepEqual(result.hits, []);
  }
});

test('literal search refuses a moving deletion epoch and withholds all snippets', async () => {
  let epoch = 7;
  const records = [{
    ...record('source-1', 'private sample', 1),
    get text() {
      epoch = 8;
      return 'private sample';
    },
  }];
  const stale = await capillary.searchSources({ query: 'sample', records, readEpoch: async () => epoch });
  assert.equal(stale.ok, false);
  assert.equal(stale.untrusted, true);
  assert.equal(stale.refused, true);
  assert.equal(stale.code, 'deletion-epoch-changed');
  assert.deepEqual([stale.epochStart, stale.epochEnd], [7, 8]);
  assert.deepEqual(stale.hits, []);
  assert.doesNotMatch(JSON.stringify(stale), /private sample/);

  epoch = 7;
  const unavailable = await capillary.searchSources({ query: 'sample', records, readEpoch: () => null });
  assert.equal(unavailable.code, 'deletion-epoch-unavailable');
  assert.deepEqual(unavailable.hits, []);
  assert.equal(epoch, 7);

  const current = await capillary.searchSources({ query: 'sample', records, readEpoch: () => 8 });
  assert.equal(current.ok, true);
  assert.equal(current.deletionEpoch, 8);
  assert.equal(current.hits.length, 1);
});
