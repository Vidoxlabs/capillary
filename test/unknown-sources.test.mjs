import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  recordSource, recordUnknownSource, isUnknownSource, UNKNOWN_REASONS, ProvenanceError,
} from '../src/provenance.mjs';
import { buildContextPacket, OMISSION_REASONS, PacketError } from '../src/packet.mjs';
import { VERSION } from '../src/index.mjs';

const DIGEST = 'a'.repeat(64);

const item = (id, text, sourceId = 'src-1', sourceDigest = DIGEST) => ({ id, sourceId, sourceDigest, text });

test('a source whose digest cannot be given is recorded as unknown, not dropped', () => {
  assert.deepEqual(UNKNOWN_REASONS, ['not-found', 'read-failed', 'digest-unavailable']);
  const unknown = recordUnknownSource({
    id: 'src-9', title: 'Missing chapter', origin: 'repository', originRef: 'docs/chapter-9.md', reason: 'not-found',
  });
  assert.equal(unknown.status, 'unknown');
  assert.equal(unknown.digest, null);
  assert.equal(unknown.reason, 'not-found');
  assert.equal(isUnknownSource(unknown), true);
  assert.throws(() => { unknown.digest = DIGEST; }, TypeError);           // never filled in later

  const known = recordSource({ id: 'src-1', title: 't', digest: DIGEST, origin: 'text', originRef: 'r', evidenceClass: 'operator-intent', confidence: 'direct-operator' });
  assert.equal(known.status, 'recorded');
  assert.equal(isUnknownSource(known), false);
});

test('an unknown record still says where it looked and why it failed', () => {
  const base = { id: 's', title: 't', origin: 'url', originRef: 'r', reason: 'read-failed' };
  assert.throws(() => recordUnknownSource({ ...base, id: '' }), ProvenanceError);
  assert.throws(() => recordUnknownSource({ ...base, origin: 'elsewhere' }), ProvenanceError);
  assert.throws(() => recordUnknownSource({ ...base, originRef: '' }), ProvenanceError);
  assert.throws(() => recordUnknownSource({ ...base, reason: 'empty' }), ProvenanceError);
  assert.throws(() => recordUnknownSource({ ...base, reason: undefined }), ProvenanceError);
  assert.equal(recordUnknownSource({ ...base, title: undefined }).title, null);  // a title may be unknown too
});

test('an unknown source does not adopt a supplied evidence class or confidence', () => {
  const unknown = recordUnknownSource({
    id: 'src-9', origin: 'text', originRef: 'r', reason: 'read-failed',
    evidenceClass: 'verified-outcome', confidence: 'direct-tool',
  });
  assert.equal(isUnknownSource(unknown), true);
  assert.equal(Object.hasOwn(unknown, 'evidenceClass'), false);
  assert.equal(Object.hasOwn(unknown, 'confidence'), false);
});

test('excerpts of an unknown source never enter a packet, even with a digest attached', () => {
  const unknown = recordUnknownSource({ id: 'src-9', title: 'Gone', origin: 'url', originRef: 'r', reason: 'read-failed' });
  const packet = buildContextPacket({
    items: [
      item('i-1', 'known text'),
      item('i-2', 'filled in from elsewhere', 'src-9', DIGEST),
      { id: 'i-3', sourceId: 'src-9', sourceDigest: null, text: '' },
    ],
    unknownSources: [unknown],
  });
  assert.deepEqual(packet.items.map(admitted => admitted.id), ['i-1']);
  assert.deepEqual(packet.omitted, [
    { id: 'i-2', reason: 'unknown-source' },
    { id: 'i-3', reason: 'unknown-source' },
  ]);
  assert.deepEqual(packet.unknown, [{ sourceId: 'src-9', origin: 'url', originRef: 'r', reason: 'read-failed' }]);
});

test('a retrieval that found only unknowns is not reported as no results', () => {
  const unknown = recordUnknownSource({ id: 'src-9', origin: 'workspace-file', originRef: 'notes.md', reason: 'not-found' });
  const onlyUnknown = buildContextPacket({ items: [], unknownSources: [unknown] });
  const empty = buildContextPacket({ items: [] });
  assert.equal(onlyUnknown.items.length, 0);
  assert.equal(onlyUnknown.unknown.length, 1);
  assert.deepEqual(empty.unknown, []);
  assert.notDeepEqual(onlyUnknown, empty);
});

test('omissions keep input order across reasons', () => {
  const unknown = recordUnknownSource({ id: 'src-9', origin: 'text', originRef: 'r', reason: 'digest-unavailable' });
  const packet = buildContextPacket({
    totalBudget: 5,
    items: [item('i-1', 'abcde'), item('i-2', 'late'), item('i-3', 'gone', 'src-9'), item('i-4', 'later')],
    unknownSources: [unknown],
  });
  assert.deepEqual(packet.omitted, [
    { id: 'i-2', reason: 'out-of-budget' },
    { id: 'i-3', reason: 'unknown-source' },
    { id: 'i-4', reason: 'out-of-budget' },
  ]);
});

test('the packet refuses a malformed unknown list', () => {
  const known = recordSource({ id: 'src-1', title: 't', digest: DIGEST, origin: 'text', originRef: 'r', evidenceClass: 'operator-intent', confidence: 'direct-operator' });
  assert.throws(() => buildContextPacket({ items: [], unknownSources: 'src-9' }), PacketError);
  assert.throws(() => buildContextPacket({ items: [], unknownSources: [known] }), PacketError);           // known is not unknown
  assert.throws(() => buildContextPacket({ items: [], unknownSources: [{ id: 'src-9', status: 'unknown' }] }), PacketError);
});

test('omission reasons are a closed set', () => {
  assert.deepEqual(OMISSION_REASONS, ['out-of-budget', 'unknown-source']);
});

test('the exported version matches the package', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(VERSION, pkg.version);
});
