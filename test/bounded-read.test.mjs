import test from 'node:test';
import assert from 'node:assert/strict';

import * as capillary from '../src/index.mjs';

const source = capillary.recordSource({
  id: 'source-1', title: 'Source note', digest: 'a'.repeat(64), origin: 'text', originRef: 'notes',
  evidenceClass: 'model-proposal', confidence: 'model-unverified',
});

test('a bounded read returns only the budgeted caller text and declares continuation', () => {
  const result = capillary.readSource({ sourceId: source.id, sources: [source], text: 'abcdefghij', tokenBudget: 2 });
  assert.deepEqual(result, {
    ok: true, untrusted: true, source, text: 'abcdefgh', tokenEstimate: 2,
    truncated: true, requestedTokenBudget: 2, continuationAvailable: true,
  });
  assert.equal(capillary.readSource({ sourceId: source.id, sources: [source], text: 'abcde', tokenBudget: 1 }).text, 'abcd');
});

test('a whole read has no continuation and counts Unicode code points', () => {
  const input = { sourceId: source.id, sources: [source], text: 'a🌱bc', tokenBudget: 1 };
  const whole = capillary.readSource(input);
  assert.equal(whole.ok, true);
  assert.equal(whole.untrusted, true);
  assert.equal(whole.text, input.text);
  assert.equal(whole.truncated, false);
  assert.equal(whole.continuationAvailable, false);
  const cut = capillary.readSource({ ...input, text: 'abc🌱d' });
  assert.equal(cut.text, 'abc🌱');
  assert.equal(cut.continuationAvailable, true);
});

test('missing, unknown, and invalid sources cannot return text', () => {
  const unknown = capillary.recordUnknownSource({ id: 'unknown', origin: 'text', originRef: 'notes', reason: 'read-failed' });
  for (const [sourceId, sources, code] of [
    ['missing', [source], 'source-not-found'],
    [unknown.id, [unknown], 'source-unavailable'],
    [source.id, [{ ...source, evidenceClass: undefined }], 'source-unavailable'],
  ]) {
    const result = capillary.readSource({ sourceId, sources, text: 'must stay withheld', tokenBudget: 2 });
    assert.equal(result.ok, false);
    assert.equal(result.untrusted, true);
    assert.equal(result.error.code, code);
    assert.equal(result.continuationAvailable, false);
    assert.equal(Object.hasOwn(result, 'text'), false);
  }
});

test('a malformed token budget returns an untrusted error', () => {
  const result = capillary.readSource({ sourceId: source.id, sources: [source], text: 'abc', tokenBudget: -1 });
  assert.equal(result.ok, false);
  assert.equal(result.untrusted, true);
  assert.equal(result.error.code, 'invalid-token-budget');
  assert.equal(result.requestedTokenBudget, null);
});
