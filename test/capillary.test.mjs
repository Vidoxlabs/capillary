import { test } from 'node:test';
import assert from 'node:assert/strict';

import { recordSource, ProvenanceError, ORIGIN_CLASSES } from '../src/provenance.mjs';
import { buildContextPacket, BLOOM_BASELINE, PacketError } from '../src/packet.mjs';
import { relationRecord, isSoundLedger, RelationError } from '../src/relations.mjs';
import { walkParentChain } from '../src/index.mjs';

const DIGEST = 'a'.repeat(64);
const otherDigest = 'b'.repeat(64);

const item = (id, text, sourceId = 'src-1', sourceDigest = DIGEST) => ({
  id, sourceId, sourceDigest, text,
});

test('sources carry provenance or they are not sources', () => {
  const source = recordSource({ id: 'src-1', title: 'Field notebook', digest: DIGEST, origin: 'text', originRef: 'notes/field-2026' });
  assert.equal(source.id, 'src-1');
  assert.throws(() => recordSource({ id: '', title: 't', digest: DIGEST, origin: 'text', originRef: 'r' }), ProvenanceError);
  assert.throws(() => recordSource({ id: 's', title: '', digest: DIGEST, origin: 'text', originRef: 'r' }), ProvenanceError);
  assert.throws(() => recordSource({ id: 's', title: 't', digest: 'nothex', origin: 'text', originRef: 'r' }), ProvenanceError);
  assert.throws(() => recordSource({ id: 's', title: 't', digest: DIGEST, origin: 'somewhere', originRef: 'r' }), ProvenanceError);
  assert.throws(() => recordSource({ id: 's', title: 't', digest: DIGEST, origin: 'text', originRef: '' }), ProvenanceError);
  assert.equal(ORIGIN_CLASSES.has('run-artifact'), true);
});

test('small items pass through whole: not shortened, nothing cut', () => {
  const packet = buildContextPacket({ items: [item('i-1', 'Water rises in fine channels.'), item('i-2', 'So does context.')] });
  assert.equal(packet.items.length, 2);
  assert.equal(packet.omitted.length, 0);
  for (const admitted of packet.items) {
    assert.equal(admitted.shortened, false);
    assert.equal(admitted.cut, 0);
  }
  assert.equal(packet.totalBudget, BLOOM_BASELINE.TOTAL_EXCERPT_BUDGET);
  assert.equal(packet.perItemBudget, BLOOM_BASELINE.PER_ITEM_BUDGET);
});

test('long items are shortened with the cut declared, never silent', () => {
  const long = 'x'.repeat(13_000);
  const packet = buildContextPacket({ items: [item('i-1', long)] });
  const admitted = packet.items[0];
  assert.equal(admitted.shortened, true);
  assert.equal(admitted.carried, 12_000);
  assert.equal(admitted.cut, 1_000);
  assert.equal(admitted.text.length, 12_000);
});

test('the total budget clips later items and lists what it left out', () => {
  const packet = buildContextPacket({
    totalBudget: 100,
    perItemBudget: 80,
    items: [item('i-1', 'a'.repeat(60)), item('i-2', 'b'.repeat(50)), item('i-3', 'c'.repeat(10))],
  });
  assert.equal(packet.items[0].carried, 60);
  assert.equal(packet.items[0].shortened, false);
  assert.equal(packet.items[1].carried, 40);
  assert.equal(packet.items[1].cut, 10);
  assert.deepEqual(packet.omitted, [{ id: 'i-3', reason: 'out-of-budget' }]);
});

test('untethered prose never enters a packet', () => {
  assert.throws(() => buildContextPacket({ items: [{ id: 'i-1', text: 'no source here' }] }), PacketError);
  assert.throws(() => buildContextPacket({ items: [item('i-1', 'x', 'src-1', 'bad-digest')] }), PacketError);
  assert.throws(() => buildContextPacket({ items: [item('i-1', '')] }), PacketError);
  assert.throws(() => buildContextPacket({ items: [], perItemBudget: 80, totalBudget: 0 }), PacketError);
});

test('relations are typed, closed, and never self-pointing', () => {
  const record = relationRecord({ type: 'derived-from', from: 'src-2', to: 'src-1' });
  assert.equal(record.type, 'derived-from');
  assert.throws(() => relationRecord({ type: 'smells-like', from: 'a', to: 'b' }), RelationError);
  assert.throws(() => relationRecord({ type: 'references', from: 'a', to: '' }), RelationError);
  assert.throws(() => relationRecord({ type: 'references', from: 'a', to: 'a' }), RelationError);
});

test('a sound ledger resolves every endpoint and keeps no duplicates', () => {
  const sources = ['src-1', 'src-2'];
  const relations = [
    relationRecord({ type: 'derived-from', from: 'src-2', to: 'src-1' }),
    relationRecord({ type: 'references', from: 'src-2', to: 'src-1' }),
  ];
  const sound = isSoundLedger({ sources, relations });
  assert.equal(sound.ok, true);
  assert.deepEqual(sound.errors, []);

  const dangling = isSoundLedger({ sources, relations: [relationRecord({ type: 'subsumes', from: 'src-9', to: 'src-1' })] });
  assert.equal(dangling.ok, false);
  assert.match(dangling.errors[0], /unknown source "src-9"/);

  const duplicated = isSoundLedger({ sources, relations: [relations[0], relations[0]] });
  assert.equal(duplicated.ok, false);
  assert.match(duplicated.errors[0], /duplicates/);
});

test('ledger records remain frozen once written', () => {
  const record = relationRecord({ type: 'revised-from', from: 'src-2', to: 'src-1' });
  assert.throws(() => { record.type = 'references'; }, TypeError);
  assert.equal(record.type, 'revised-from');
});

test('a parent walk follows known links from nearest parent to root', () => {
  const parentsById = new Map([['child', 'parent'], ['parent', 'root'], ['root', null], ['unrelated', null]]);
  const result = walkParentChain({ startId: 'child', parentsById });
  assert.deepEqual(result, { parentIds: ['parent', 'root'], stop: 'root', at: 'root' });
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.parentIds));
});

test('a parent walk stops at the first missing link and reports its id', () => {
  const links = [['child', 'parent'], ['parent', 'missing'], ['unrelated', null]];
  const parentsById = new Map(links);
  assert.deepEqual(walkParentChain({ startId: 'child', parentsById }),
    { parentIds: ['parent'], stop: 'missing', at: 'missing' });
  assert.deepEqual(walkParentChain({ startId: 'unknown', parentsById }),
    { parentIds: [], stop: 'missing', at: 'unknown' });
  assert.deepEqual([...parentsById], links);
});

test('a parent walk reports cycles and the hop limit', () => {
  const parentsById = new Map([['child', 'parent'], ['parent', 'grandparent'], ['grandparent', 'parent']]);
  assert.deepEqual(walkParentChain({ startId: 'child', parentsById }),
    { parentIds: ['parent', 'grandparent'], stop: 'cycle', at: 'parent' });
  assert.deepEqual(walkParentChain({ startId: 'child', parentsById, limit: 1 }),
    { parentIds: ['parent'], stop: 'limit', at: 'grandparent' });
  assert.deepEqual(walkParentChain({ startId: 'child', parentsById, limit: 0 }),
    { parentIds: [], stop: 'limit', at: 'parent' });
  assert.throws(() => walkParentChain({ startId: 'child', parentsById, limit: 51 }), RelationError);
  assert.throws(() => walkParentChain({ startId: 'child', parentsById, limit: -1 }), RelationError);
});
