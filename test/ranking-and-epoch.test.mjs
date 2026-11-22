import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildContextPacket, PacketError, buildEpochGuardedPacket, EPOCH_REFUSALS,
} from '../src/index.mjs';

const DIGEST = 'a'.repeat(64);
const item = (id, extra = {}) => ({ id, sourceId: 'src-1', sourceDigest: DIGEST, text: `text of ${id}`, ...extra });

test('relevance and recency stay separate fields on every admitted item', () => {
  const packet = buildContextPacket({
    items: [
      item('i-1', { relevance: 0.91, recency: 1_700_000_000_000 }),
      item('i-2', { relevance: 0.12 }),
      item('i-3', { recency: 1_800_000_000_000 }),
      item('i-4'),
    ],
  });
  const dims = packet.items.map(({ id, relevance, recency }) => ({ id, relevance, recency }));
  assert.deepEqual(dims, [
    { id: 'i-1', relevance: 0.91, recency: 1_700_000_000_000 },
    { id: 'i-2', relevance: 0.12, recency: null },                        // recency is not filled in
    { id: 'i-3', relevance: null, recency: 1_800_000_000_000 },           // relevance is not filled in
    { id: 'i-4', relevance: null, recency: null },
  ]);
  for (const admitted of packet.items) assert.equal(Object.hasOwn(admitted, 'score'), false);
  assert.deepEqual(packet.items.map(admitted => admitted.id), ['i-1', 'i-2', 'i-3', 'i-4']); // order is the caller's
});

test('a fused score or a malformed dimension is refused', () => {
  assert.throws(() => buildContextPacket({ items: [item('i-1', { score: 0.7 })] }), /fused score/);
  assert.throws(() => buildContextPacket({ items: [item('i-1', { relevance: '0.7' })] }), PacketError);
  assert.throws(() => buildContextPacket({ items: [item('i-1', { relevance: Number.NaN })] }), PacketError);
  assert.throws(() => buildContextPacket({ items: [item('i-1', { recency: -1 })] }), PacketError);
  assert.throws(() => buildContextPacket({ items: [item('i-1', { recency: '2026-01-01' })] }), PacketError);
});

function epochs(...values) {
  let reads = 0;
  return {
    readEpoch: async () => {
      const value = values[Math.min(reads, values.length - 1)];
      reads += 1;
      if (value instanceof Error) throw value;
      return value;
    },
    get reads() { return reads; },
  };
}

test('a packet built under a stable epoch carries that epoch', async () => {
  const clock = epochs(4, 4);
  const packet = await buildEpochGuardedPacket({
    readEpoch: clock.readEpoch,
    read: async () => ({ items: [item('i-1', { relevance: 0.5, recency: 10 })] }),
  });
  assert.equal(packet.deletionEpoch, 4);
  assert.deepEqual(packet.items.map(admitted => admitted.id), ['i-1']);
  assert.equal(clock.reads, 2);
});

test('a packet is refused when the epoch at the end differs from the epoch at the start', async () => {
  const result = await buildEpochGuardedPacket({
    readEpoch: epochs(4, 5).readEpoch,
    read: async () => ({ items: [item('i-1'), item('i-2')] }),
  });
  assert.equal(result.refused, true);
  assert.equal(result.code, 'deletion-epoch-changed');
  assert.equal(result.epochStart, 4);
  assert.equal(result.epochEnd, 5);
  assert.equal(Object.hasOwn(result, 'items'), false);                    // a refusal is not an empty packet
  assert.equal(Object.isFrozen(result), true);
});

test('a forget that lands during the read refuses the rows read before it', async () => {
  let epoch = 7;
  const store = [item('kept'), item('forgotten')];
  const result = await buildEpochGuardedPacket({
    readEpoch: async () => epoch,
    read: async () => {
      const rows = [...store];
      store.pop();                                                         // the forget runs mid-read
      epoch += 1;
      return { items: rows };
    },
  });
  assert.equal(result.code, 'deletion-epoch-changed');
  const retry = await buildEpochGuardedPacket({ readEpoch: async () => epoch, read: async () => ({ items: [...store] }) });
  assert.deepEqual(retry.items.map(admitted => admitted.id), ['kept']);
  assert.equal(retry.deletionEpoch, 8);
});

test('an epoch that cannot be read is a refusal, before or after the read', async () => {
  let ran = false;
  const before = await buildEpochGuardedPacket({
    readEpoch: epochs(new Error('store down')).readEpoch,
    read: async () => { ran = true; return { items: [item('i-1')] }; },
  });
  assert.equal(before.code, 'deletion-epoch-unavailable');
  assert.equal(ran, false);                                                // nothing is read without a start epoch
  for (const end of [null, -1, 1.5, '4', new Error('gone')]) {
    const after = await buildEpochGuardedPacket({ readEpoch: epochs(4, end).readEpoch, read: async () => ({ items: [item('i-1')] }) });
    assert.equal(after.code, 'deletion-epoch-unavailable');
    assert.equal(after.epochStart, 4);
  }
  assert.deepEqual(EPOCH_REFUSALS, ['deletion-epoch-changed', 'deletion-epoch-unavailable']);
});
