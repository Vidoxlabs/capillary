/**
 * Deletion-epoch guard around one retrieval. Contract: docs/contracts/retrieval.md
 * ("Deletion epoch"). Capillary does not own the epoch: the caller hands in a function
 * that reads it from whichever store forgets. Nothing here opens a listener.
 */

import { buildContextPacket } from './packet.mjs';

export const EPOCH_REFUSALS = ['deletion-epoch-changed', 'deletion-epoch-unavailable'];

const isEpoch = (value) => Number.isSafeInteger(value) && value >= 0;

async function readEpochSafely(readEpoch) {
  try {
    const value = await readEpoch();
    return isEpoch(value) ? value : null;
  } catch {
    return null;
  }
}

const refuse = (code, epochStart, epochEnd, reason) => Object.freeze({
  refused: true, code, epochStart, epochEnd, reason,
});

/**
 * Read the deletion epoch, run the read, read the epoch again, then build the packet.
 *
 * - When the two epochs differ, a forget landed during the read. The rows may include
 *   something that is now forgotten, so no packet is built: the result is a refusal with
 *   code `deletion-epoch-changed` and both epochs.
 * - When either epoch cannot be read as a non-negative integer, the read cannot show it
 *   was stable, and the result is a refusal with code `deletion-epoch-unavailable`.
 * - A refusal has no `items`. It is never an empty packet.
 *
 * `read()` returns `{ items, unknownSources? }`. Budgets pass through to
 * buildContextPacket. A packet built under a stable epoch carries `deletionEpoch`.
 */
export async function buildEpochGuardedPacket({ readEpoch, read, totalBudget, perItemBudget }) {
  if (typeof readEpoch !== 'function') throw new TypeError('readEpoch must be a function.');
  if (typeof read !== 'function') throw new TypeError('read must be a function.');
  const epochStart = await readEpochSafely(readEpoch);
  if (epochStart === null) {
    return refuse('deletion-epoch-unavailable', null, null, 'The deletion epoch could not be read before retrieval.');
  }
  const rows = await read();
  const epochEnd = await readEpochSafely(readEpoch);
  if (epochEnd === null) {
    return refuse('deletion-epoch-unavailable', epochStart, null, 'The deletion epoch could not be read after retrieval.');
  }
  if (epochEnd !== epochStart) {
    return refuse('deletion-epoch-changed', epochStart, epochEnd,
      'A forget landed during retrieval; the rows read may include forgotten content.');
  }
  const packet = buildContextPacket({
    items: rows?.items,
    unknownSources: rows?.unknownSources ?? [],
    ...(totalBudget === undefined ? {} : { totalBudget }),
    ...(perItemBudget === undefined ? {} : { perItemBudget }),
  });
  return { ...packet, deletionEpoch: epochStart };
}
